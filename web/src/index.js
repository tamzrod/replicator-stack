const express = require('express');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const DATA_DIR = process.env.DATA_DIR || '/app/data';
const TARGET_HOST = process.env.TARGET_HOST || 'mma';
let APP_VERSION = process.env.APP_VERSION || 'dev';
let DOCKER_DIGEST = process.env.DOCKER_DIGEST || null;
const GIT_SHA = process.env.GIT_SHA || null;
const MODEL_PATH = path.join(DATA_DIR, 'model.json');
const REPLICATOR_CONFIG_PATH = path.join(DATA_DIR, 'replicator/config.yaml');
const MMA_CONFIG_PATH = path.join(DATA_DIR, 'mma/config.yaml');

const DEFAULT_SYSTEM = {};

// Number of holding registers consumed by each device's status slot.
const STATUS_SLOT_SIZE = 30;

// ---------------------------------------------------------------------------
// In-memory model cache — eliminates repeated fs.readFileSync / JSON.parse
// on every request.  Invalidated (and re-populated) on every writeModel().
//
// CONTRACT: callers that mutate the returned object MUST call writeModel()
// afterwards to keep the cache and disk in sync.  All existing route handlers
// already follow this pattern.
// ---------------------------------------------------------------------------
let _modelCache = null;

// ---------------------------------------------------------------------------
// Canonical version counter — the single source-of-truth version stamp.
//
// Incremented every time compileAndWrite() successfully writes both YAML
// config files to disk.  Returned alongside the model and compiled YAML in
// GET /model/snapshot so every UI view can prove it is rendering the same
// compiled state.  Never reset (monotonically increasing within a process
// lifetime; clients should treat it as an opaque comparable token).
// ---------------------------------------------------------------------------
let _canonicalVersion = 0;

// ---------------------------------------------------------------------------
// Compile queue — decouples autoCompile from the synchronous CRUD hot path.
// A short debounce ensures rapid back-to-back mutations only trigger one
// compile pass.  The compile result is always based on the latest model
// (readModel() is O(1) via _modelCache).
//
// _compilePending and _lastMutationTimestamp are observability flags that
// expose queue state (e.g. a future GET /compile/status endpoint).
// ---------------------------------------------------------------------------
let _compilePending = false;        // true while a compile timer is outstanding
let _lastMutationTimestamp = 0;     // ms timestamp of the most recent mutation
let _compileTimer = null;
const COMPILE_DEBOUNCE_MS = 50;

function scheduleCompile() {
    _compilePending = true;
    _lastMutationTimestamp = Date.now();
    if (_compileTimer) clearTimeout(_compileTimer);
    _compileTimer = setTimeout(() => {
        _compilePending = false;
        _compileTimer = null;
        autoCompile(readModel());
    }, COMPILE_DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// Index maps — O(1) lookup caches derived from _modelCache.
//
// Rebuilt by rebuildIndexes() which is called from writeModel() (after every
// successful mutation) and from readModel() (on the first cold read).
//
// CONTRACT: indexes are read-only derived caches — they NEVER modify model
// data and NEVER affect logic outcomes.  Model remains the sole source of
// truth; these Maps exist purely to eliminate repeated O(n) array scans.
//
// Map keys and their meanings:
//   devicesById           — device.id (string UUID) → device object
//   devicesByUnitId       — device.unitId (number)  → device object
//   devicesByStatusUnitId — device.status_unit_id (number | null) → device[]
//   devicesByStatusSlot   — device.status_slot (number) → device[]
//   portsById             — port.id (string UUID)  → port object
//   portsByNumber         — port.port (number)     → port object
// ---------------------------------------------------------------------------
const _idx = {
    devicesById:           new Map(),
    devicesByUnitId:       new Map(),
    devicesByStatusUnitId: new Map(),
    devicesByStatusSlot:   new Map(),
    devicesByTarget:       new Map(), // "device.target_endpoint|device.unitId" (composite key) → device object
                                       // unitId is a system-managed value that should be unique across all devices;
                                       // enforced at creation/duplicate time via devicesByUnitId lookups.
    portsById:             new Map(),
    portsByNumber:         new Map(),
};

function rebuildIndexes(model) {
    _idx.devicesById.clear();
    _idx.devicesByUnitId.clear();
    _idx.devicesByStatusUnitId.clear();
    _idx.devicesByStatusSlot.clear();
    _idx.devicesByTarget.clear();
    _idx.portsById.clear();
    _idx.portsByNumber.clear();

    for (const device of (model.devices || [])) {
        _idx.devicesById.set(device.id, device);

        const parsedUnitId = Number(device.unitId);
        if (Number.isFinite(parsedUnitId)) {
            _idx.devicesByUnitId.set(parsedUnitId, device);
        }

        // null is a valid Map key — devices with no status_unit_id are stored under null
        const statusUnitIdKey = device.status_unit_id != null ? Number(device.status_unit_id) : null;
        if (!_idx.devicesByStatusUnitId.has(statusUnitIdKey)) {
            _idx.devicesByStatusUnitId.set(statusUnitIdKey, []);
        }
        _idx.devicesByStatusUnitId.get(statusUnitIdKey).push(device);

        const slot = Number(device.status_slot ?? 0);
        if (Number.isFinite(slot)) {
            if (!_idx.devicesByStatusSlot.has(slot)) {
                _idx.devicesByStatusSlot.set(slot, []);
            }
            _idx.devicesByStatusSlot.get(slot).push(device);
        }

        if (device.target_endpoint) {
            _idx.devicesByTarget.set(`${device.target_endpoint.trim()}|${device.unitId}`, device);
        }
    }

    for (const port of ((model.memory && model.memory.ports) || [])) {
        _idx.portsById.set(port.id, port);
        _idx.portsByNumber.set(Number(port.port), port);
    }

    // Debug-level consistency check: index sizes must match source array lengths.
    // Mismatches indicate duplicate IDs in the model (a data-integrity violation
    // enforced at creation time).  This assertion is informational only — it
    // does not alter the model or raise an exception in production.
    const deviceCount = (model.devices || []).length;
    const portCount   = ((model.memory && model.memory.ports) || []).length;
    console.assert(
        _idx.devicesById.size === deviceCount,
        `[idx] devicesById size mismatch: ${_idx.devicesById.size} entries vs ${deviceCount} devices — duplicate device IDs detected`
    );
    console.assert(
        _idx.portsById.size === portCount,
        `[idx] portsById size mismatch: ${_idx.portsById.size} entries vs ${portCount} ports — duplicate port IDs detected`
    );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate that a value is a required positive integer (e.g. for unit IDs).
 * Returns true if valid, false otherwise.
 */
function isRequiredNonNegativeInt(value) {
    if (value == null || value === '') return false;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0;
}

function initialModel() {
    return { system: DEFAULT_SYSTEM, groups: [], devices: [], memory: { ports: [] } };
}

function readModel() {
    if (_modelCache !== null) {
        return _modelCache;
    }
    if (!fs.existsSync(MODEL_PATH)) {
        const initial = initialModel();
        writeModel(initial);
        return initial;
    }
    let model;
    try {
        model = JSON.parse(fs.readFileSync(MODEL_PATH, 'utf-8'));
    } catch (parseErr) {
        console.error(`[readModel] Failed to parse ${MODEL_PATH}: ${parseErr.message} — resetting to initial model`);
        const initial = initialModel();
        writeModel(initial);
        return initial;
    }
    if (!Array.isArray(model.devices)) model.devices = [];
    if (!Array.isArray(model.groups)) model.groups = [];
    if (!model.system) model.system = {};
    if (!model.memory) model.memory = { ports: [] };
    if (!Array.isArray(model.memory.ports)) model.memory.ports = [];
    // Ensure each port has units[] (new field for manual unit-based config)
    for (const port of model.memory.ports) {
        if (!Array.isArray(port.units)) {
            port.units = [];
            // Note: units[] starts empty; users can auto-populate from device reads
            // via POST /memory/port/:portId/units/populate or add units manually.
        }
    }
    let migrated = false;
    // Normalize duplicate area types within units: merge same-type areas using widest range.
    // This ensures the model is always consistent with the MMA config compiler's merge behaviour.
    for (const port of model.memory.ports) {
        for (const unit of (port.units || [])) {
            if (!Array.isArray(unit.areas) || unit.areas.length < 2) continue;
            const byType = new Map();
            let hasDuplicates = false;
            for (const area of unit.areas) {
                if (!byType.has(area.type)) {
                    byType.set(area.type, { ...area });
                } else {
                    const ex = byType.get(area.type);
                    const newEnd = Math.max(ex.start + ex.count - 1, area.start + area.count - 1);
                    ex.start = Math.min(ex.start, area.start);
                    ex.count = newEnd - ex.start + 1;
                    hasDuplicates = true;
                    migrated = true;
                }
            }
            if (hasDuplicates) unit.areas = [...byType.values()];
        }
    }
    for (const device of model.devices) {
        // Migrate old free-text device.group → device.groupId using group entities
        if (device.group && !device.groupId) {
            let grp = model.groups.find(g => g.name === device.group);
            if (!grp) {
                grp = { id: randomUUID(), name: device.group };
                model.groups.push(grp);
            }
            device.groupId = grp.id;
            delete device.group;
            migrated = true;
        }
        // Migrate old device.host → device.ipAddress
        if (device.host && !device.ipAddress) {
            device.ipAddress = device.host;
            delete device.host;
            migrated = true;
        }
        // Migrate old device.ipAddress + device.port → device.source_endpoint
        if ((device.ipAddress || device.port) && !device.source_endpoint) {
            const ip = (device.ipAddress || 'localhost').trim();
            const p = Number(device.port) || 502;
            device.source_endpoint = `${ip}:${p}`;
            delete device.ipAddress;
            delete device.port;
            migrated = true;
        }
        // Migrate old auto-assigned assigned_unit_id → explicit unitId
        if ('assigned_unit_id' in device && !('unitId' in device)) {
            device.unitId = device.assigned_unit_id;
            migrated = true;
        }
        if ('assigned_unit_id' in device) {
            delete device.assigned_unit_id;
            migrated = true;
        }
        // Remove legacy target_name reference (target concept removed)
        if ('target_name' in device) {
            delete device.target_name;
            migrated = true;
        }
    }
    // Migrate old system.targets → model.memory.ports (preserve port numbers, drop empty)
    if (Array.isArray(model.system.targets) && model.system.targets.length > 0
            && model.memory.ports.length === 0) {
        for (const t of model.system.targets) {
            const port = t.port || Number((t.endpoint || '').split(':')[1]) || 502;
            if (Number.isFinite(port) && port > 0) {
                model.memory.ports.push({ id: randomUUID(), port, blocks: [] });
            }
        }
        migrated = true;
    }
    if (Array.isArray(model.system.targets)) {
        delete model.system.targets;
        migrated = true;
    }
    // Migrate missing target_endpoint: derive from mma_endpoint system setting + memory port lookup
    {
        const unitToPortNum = {};
        for (const port of model.memory.ports) {
            for (const block of (port.blocks || [])) {
                const uid = Number(block.unit_id);
                if (Number.isFinite(uid) && !(uid in unitToPortNum)) {
                    unitToPortNum[uid] = Number(port.port) || 502;
                }
            }
        }
        const defaultMmaHost = (model.system && model.system.mma_endpoint) || TARGET_HOST;
        const defaultPortNum = (model.memory.ports[0] && Number(model.memory.ports[0].port)) || 502;
        for (const device of model.devices) {
            if (!device.target_endpoint) {
                const targetPort = (device.unitId != null && unitToPortNum[Number(device.unitId)] != null)
                    ? unitToPortNum[Number(device.unitId)]
                    : defaultPortNum;
                device.target_endpoint = `${defaultMmaHost}:${targetPort}`;
                migrated = true;
            }
        }
    }
    if (migrated) writeModel(model);
    _modelCache = model; // always cache after the first cold read, regardless of migration
    rebuildIndexes(model);
    return model;
}

function isValidIp(ip) {
    if (typeof ip !== 'string' || !ip.trim()) return false;
    const parts = ip.trim().split('.');
    if (parts.length !== 4) return false;
    return parts.every(p => /^\d+$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

// Validate a free-form endpoint string: "<host>:<port>" where host may be an
// IP address, docker service name, or "localhost".
function isValidEndpoint(endpoint) {
    if (typeof endpoint !== 'string' || !endpoint.trim()) return false;
    const lastColon = endpoint.lastIndexOf(':');
    if (lastColon < 1) return false; // no host before colon
    const port = Number(endpoint.slice(lastColon + 1));
    return Number.isFinite(port) && port >= 1 && port <= 65535;
}

// Extract the port number from an endpoint string. Returns null on failure.
function endpointPort(endpoint) {
    if (typeof endpoint !== 'string') return null;
    const lastColon = endpoint.lastIndexOf(':');
    if (lastColon < 0) return null;
    const port = Number(endpoint.slice(lastColon + 1));
    return Number.isFinite(port) && port >= 1 && port <= 65535 ? port : null;
}

// Return sorted array of port numbers referenced by device target_endpoints
// that do not yet exist in model.memory.ports.
function getMissingTargetPorts(model) {
    const existingPortNums = new Set((model.memory.ports || []).map(p => Number(p.port)));
    const missing = new Set();
    for (const device of (model.devices || [])) {
        const port = endpointPort(device.target_endpoint);
        if (port != null && !existingPortNums.has(port)) {
            missing.add(port);
        }
    }
    return [...missing].sort((a, b) => a - b);
}

function findGroup(model, groupId) {
    return (model.groups || []).find(g => g.id === groupId) || null;
}

// Ensure a memory port, unit, and areas exist for the device's target_endpoint + unitId,
// and keep the unit's area types in sync with the actual reads.
//
// Creates the port and/or unit if absent.  Then it computes the complete set of
// source_area types required by ALL devices that target the same (portNum, unitId) —
// including the triggering device — and:
//   • removes areas whose type is no longer required by any device read (stale areas)
//   • adds areas for types that are missing, using the merged address range from reads
//   • leaves areas whose type is still required untouched (preserving user-set start/count)
//
// Safe to call with an already-mutated model before writeModel() — all changes are
// applied in-place and _idx is kept consistent for subsequent calls in the same request.
function ensureTargetMemory(model, device) {
    const portNum = endpointPort(device.target_endpoint);
    if (portNum == null) return; // invalid endpoint — validation catches this separately

    const unitId = Number(device.unitId);
    if (!Number.isFinite(unitId) || unitId < 0) return; // invalid unit id

    // Find or create the memory port.
    let port = _idx.portsByNumber.get(portNum) || null;
    if (!port) {
        port = { id: randomUUID(), port: portNum, blocks: [], units: [] };
        model.memory.ports.push(port);
        // Keep _idx current so subsequent ensureTargetMemory calls in the same
        // request find this port without requiring a writeModel() round-trip.
        _idx.portsByNumber.set(portNum, port);
        _idx.portsById.set(port.id, port);
        console.log(`[ensureTargetMemory] Created target memory port ${portNum} for unit_id: ${unitId}`);
    }

    // Find or create the unit within the port.
    if (!port.units) port.units = [];
    let unit = port.units.find(u => Number(u.unit_id) === unitId);
    if (!unit) {
        unit = { id: randomUUID(), unit_id: unitId, areas: [] };
        port.units.push(unit);
        console.log(`[ensureTargetMemory] Created target memory unit_id: ${unitId} on port ${portNum}`);
    } else {
        console.log(`[ensureTargetMemory] Syncing areas for unit_id: ${unitId} on port ${portNum}`);
    }

    // Collect required area types from ALL devices that target this (portNum, unitId).
    // Using the full device list ensures that an area shared by multiple devices is only
    // removed when no device still requires it.
    const readsByArea = {};
    for (const dev of (model.devices || [])) {
        if (endpointPort(dev.target_endpoint) !== portNum || Number(dev.unitId) !== unitId) continue;
        for (const read of (dev.reads || [])) {
            const areaType = read.source_area || 'holding_registers';
            const start = Number(read.source_address);
            const count = Number(read.source_count);
            if (!Number.isFinite(start) || !Number.isFinite(count) || count < 1) continue;
            if (!readsByArea[areaType]) readsByArea[areaType] = [];
            readsByArea[areaType].push({ start, end: start + count - 1 });
        }
    }

    if (!unit.areas) unit.areas = [];
    const requiredAreaTypes = new Set(Object.keys(readsByArea));

    // Remove areas whose type is no longer required by any device read.
    const before = unit.areas.length;
    unit.areas = unit.areas.filter(a => requiredAreaTypes.has(a.type));
    const removed = before - unit.areas.length;
    if (removed > 0) {
        console.log(`[ensureTargetMemory] Removed ${removed} stale area(s) from unit_id ${unitId} on port ${portNum}`);
    }

    // Add areas for types that are now required but not yet present.
    // Use the single widest range (min start → max end) so the model always
    // holds exactly one area per type per unit — matching what compileMma2Config
    // emits in the YAML and preventing the Memory tab from showing a different
    // number of entries than the generated config.
    const existingAreaTypes = new Set(unit.areas.map(a => a.type));
    for (const [areaType, ranges] of Object.entries(readsByArea)) {
        if (existingAreaTypes.has(areaType)) continue; // already present — preserve user's start/count
        const minStart = Math.min(...ranges.map(r => r.start));
        const maxEnd   = Math.max(...ranges.map(r => r.end));
        unit.areas.push({
            id: randomUUID(),
            type: areaType,
            start: minStart,
            count: maxEnd - minStart + 1,
        });
        console.log(`[ensureTargetMemory] Added area ${areaType} start=${minStart} count=${maxEnd - minStart + 1} to unit_id ${unitId}`);
    }
}

function writeModel(model) {
    _modelCache = model;
    rebuildIndexes(model);
    atomicWrite(MODEL_PATH, JSON.stringify(model, null, 2));
}

function atomicWrite(filePath, content) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const unique = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tmp = path.join(dir, `.tmp-${unique}`);
    fs.writeFileSync(tmp, content, 'utf-8');
    try {
        fs.renameSync(tmp, filePath);
    } catch (err) {
        try {
            if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        } catch (_) {
            // Best effort cleanup only.
        }
        throw err;
    }
}

function readsOverlap(a, b) {
    if (a.source_area !== b.source_area) return false;
    const aStart = Number(a.source_address);
    const aEnd = aStart + Number(a.source_count);
    const bStart = Number(b.source_address);
    const bEnd = bStart + Number(b.source_count);
    if (!Number.isFinite(aStart) || !Number.isFinite(aEnd) ||
        !Number.isFinite(bStart) || !Number.isFinite(bEnd)) return false;
    return aStart < bEnd && bStart < aEnd;
}

function findDevice(model, deviceId) {
    return _idx.devicesById.get(deviceId) || null;
}

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

/**
 * Escape a value for a CSV cell (RFC 4180).
 */
function csvCell(val) {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

/**
 * Parse a single CSV row, handling quoted fields per RFC 4180.
 */
function parseCSVRow(line) {
    const cells = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (line[i + 1] === '"') { cur += '"'; i++; }
                else { inQuotes = false; }
            } else {
                cur += ch;
            }
        } else {
            if (ch === '"') { inQuotes = true; }
            else if (ch === ',') { cells.push(cur); cur = ''; }
            else { cur += ch; }
        }
    }
    cells.push(cur);
    return cells;
}

/**
 * Generate a unique read ID that does not clash with any existing read on the device.
 */
function generateUniqueReadId(reads) {
    const existingIds = new Set((reads || []).map(r => r.id));
    let n = 1;
    while (existingIds.has(`read_${n}`)) n++;
    return `read_${n}`;
}

/**
 * Return the smallest slot index not currently used by any device sharing the
 * same target_endpoint.  Slots are zero-based and unique within a target
 * endpoint group.  Devices on different endpoints may share the same slot number.
 *
 * @param {object} model
 * @param {string} targetEndpoint  — normalised target_endpoint of the new device
 * @returns {number}
 */
function assignNextSlot(model, targetEndpoint) {
    const epKey = (targetEndpoint || '').trim().toLowerCase();
    const usedSlots = new Set(
        (model.devices || [])
            .filter(d => d.status_slot != null && (d.target_endpoint || '').trim().toLowerCase() === epKey)
            .map(d => Number(d.status_slot))
            .filter(n => Number.isFinite(n))
    );
    let next = 0;
    while (usedSlots.has(next)) next++;
    return next;
}

/**
 * Validate and fill status slot assignments, scoped per target_endpoint.
 *
 * Slots are zero-based integers that are unique within the group of devices
 * sharing the same target_endpoint (host + port).  Devices on different
 * endpoints are independent — they may share the same slot number without
 * conflict.
 *
 * Rules:
 *   - Clear any duplicate slots within an endpoint group before reassigning.
 *   - Assign missing (null) or cleared duplicate slots using the lowest available
 *     slot (gap-filling, deterministic, stable allocation).
 *   - Each endpoint group is processed independently.
 *
 * @param {object} model
 * @returns {{ modified: boolean }}
 */
function recompileStatusSlots(model) {
    const devices = model.devices || [];

    // Group devices by target_endpoint so slot uniqueness is enforced per endpoint.
    const epGroups = new Map(); // endpointKey → device[]
    for (const device of devices) {
        const key = (device.target_endpoint || '').trim().toLowerCase() || '__null__';
        if (!epGroups.has(key)) epGroups.set(key, []);
        epGroups.get(key).push(device);
    }

    let modified = false;
    for (const grpDevices of epGroups.values()) {
        // Detect duplicate slots: slot → first device that owns it (keeps it), rest are cleared.
        const slotOwner = new Map(); // slot → first device seen with that slot
        for (const device of grpDevices) {
            if (device.status_slot == null) continue;
            const slot = Number(device.status_slot);
            if (!Number.isFinite(slot)) {
                device.status_slot = null;
                modified = true;
                continue;
            }
            if (slotOwner.has(slot)) {
                // Duplicate — clear it so it gets reassigned below.
                device.status_slot = null;
                modified = true;
            } else {
                slotOwner.set(slot, device);
            }
        }

        // Collect slots that are still validly assigned (non-duplicate, non-null).
        const usedSlots = new Set(slotOwner.keys());

        for (const device of grpDevices) {
            if (device.status_slot != null) continue;
            // Find the lowest available slot within this endpoint group (gap-filling).
            let next = 0;
            while (usedSlots.has(next)) next++;
            device.status_slot = next;
            usedSlots.add(next);
            modified = true;
        }
    }
    return { modified };
}

// Maps Modbus area names to function codes (per Modbus protocol spec).
const AREA_TO_FC = {
    holding_registers: 3,
    coils: 1,
    input_registers: 4,
    discrete_inputs: 2,
    input_status: 2,
};

function toReplicatorYaml(model, excludedPortNums = new Set()) {
    // Replicator orchestration config.
    // Format per docs/sample yaml/replicator.yaml:
    //   - top-level replicator: block
    //   - replicator.units: list, one per device
    //   - each unit: source (endpoint, unit_id, device_name, status_slot),
    //                reads (fc, address, quantity),
    //                targets (id, endpoint, unit_id, memories),
    //                poll (interval_ms)
    const devices = model.devices || [];

    const lines = ['replicator:', '  units:'];

    for (const device of devices) {
        // Skip devices whose target port has been explicitly excluded (user declined creation)
        const targetPort = endpointPort(device.target_endpoint);
        if (targetPort !== null && excludedPortNums.has(targetPort)) continue;
        const deviceReads = device.reads || [];
        if (deviceReads.length === 0) continue;

        const sourceEndpoint = device.source_endpoint || '';
        const targetEndpoint = device.target_endpoint || '';
        const statusSlot = device.status_slot != null ? Number(device.status_slot) : 0;

        // Poll interval: use minimum across all reads for this device.
        const pollMs = Math.min(...deviceReads.map(r => Number(r.poll_interval) || 1000));

        lines.push(`    - id: "${device.id}"`);
        lines.push(`      source:`);
        lines.push(`        endpoint: "${sourceEndpoint}"`);
        lines.push(`        unit_id: ${device.source_unit_id}`);
        lines.push(`        device_name: "${device.name || device.id}"`);
        if (device.status_unit_id != null) {
            lines.push(`        status_slot: ${statusSlot}`);
        }
        lines.push(`      reads:`);
        for (const read of deviceReads) {
            const fc = AREA_TO_FC[read.source_area] || 3;
            lines.push(`        - fc: ${fc}`);
            lines.push(`          address: ${read.source_address}`);
            lines.push(`          quantity: ${read.source_count}`);
        }
        lines.push(`      targets:`);
        lines.push(`        - id: ${device.unitId}`);
        lines.push(`          endpoint: "${targetEndpoint}"`);
        lines.push(`          unit_id: ${device.unitId}`);
        if (device.status_unit_id != null) {
            lines.push(`          status_unit_id: ${Number(device.status_unit_id)}`);
        }
        lines.push(`          memories:`);
        lines.push(`            - memory_id: ${device.unitId}`);
        lines.push(`              offsets: {}`);
        lines.push(`      poll:`);
        lines.push(`        interval_ms: ${pollMs}`);
    }
    return lines.join('\n') + '\n';
}

/**
 * Return the primary Modbus read function code for an area type.
 * FC 1 = Read Coils, FC 2 = Read Discrete Inputs,
 * FC 3 = Read Holding Registers, FC 4 = Read Input Registers.
 */
function domainReadFc(area) {
    switch (area) {
        case 'coils':             return 1;
        case 'discrete_inputs':   return 2;
        case 'input_registers':   return 4;
        default:                  return 3; // holding_registers
    }
}

/**
 * MMA2 CONFIG COMPILER
 *
 * unit_id is a CONTAINER ID — not a strict unique memory block.  A single
 * unit_id may own multiple memory domains (holding_registers, input_registers,
 * coils, discrete_inputs).  When multiple blocks share the same unit_id on
 * the same listener port they are MERGED into one unit object rather than
 * flagged as errors.
 *
 * Merge rules:
 *   - Domains are combined into the same unit entry.
 *   - When two blocks for the same (unit_id, area) exist the widest address
 *     range is preserved (lowest start, highest end).
 *   - Policy rules are unioned and deduplicated by rule id.
 *   - Status units (driven by status_unit_id) always receive the read-write
 *     policy; regular units receive a read-only policy whose allow_fc list
 *     covers all present domain types.
 *
 * @param {Array}  blocks    - port.blocks entries (unit_id, area, address, count)
 * @param {Map}    statusMap - Map<statusUnitId, deviceCount> for status blocks
 * @returns {{ mergedUnits: Array, mergeLog: Array }}
 *   mergedUnits  — ordered list of merged unit objects ready for YAML emission
 *   mergeLog     — diagnostic records: source entries merged, fields combined,
 *                  rules deduplicated
 */
function compileMma2Config(blocks, statusMap = new Map()) {
    // byUnitId: unit_id → { unitId, isStatus, domains: Map<area,{start,count}>, sourceCount }
    const byUnitId = new Map();
    const mergeLog = [];

    function mergeBlock(uid, area, address, count, isStatus) {
        if (!byUnitId.has(uid)) {
            byUnitId.set(uid, { unitId: uid, isStatus: false, domains: new Map(), sourceCount: 0 });
        }
        const entry = byUnitId.get(uid);
        entry.sourceCount += 1;
        if (isStatus) entry.isStatus = true;

        if (entry.domains.has(area)) {
            // Preserve widest range across duplicate (unit_id, area) blocks.
            const existing = entry.domains.get(area);
            const newStart = Math.min(existing.start, address);
            const newEnd   = Math.max(existing.start + existing.count - 1, address + count - 1);
            const oldEntry = { start: existing.start, count: existing.count };
            existing.start = newStart;
            existing.count = newEnd - newStart + 1;
            if (existing.start !== oldEntry.start || existing.count !== oldEntry.count) {
                mergeLog.push({
                    unit_id: uid,
                    area,
                    action: 'range_widened',
                    from: oldEntry,
                    to: { start: existing.start, count: existing.count },
                });
            }
        } else {
            entry.domains.set(area, { start: address, count });
        }
    }

    // Process regular device-read blocks.
    for (const block of blocks) {
        mergeBlock(
            Number(block.unit_id),
            block.area || 'holding_registers',
            block.address,
            block.count,
            false
        );
    }

    // Process status memory entries (derived from devices with status_unit_id).
    for (const [suid, deviceCount] of statusMap) {
        mergeBlock(suid, 'holding_registers', 0, deviceCount * STATUS_SLOT_SIZE, true);
    }

    // Build merge log entries for unit_ids that had more than one source block.
    for (const entry of byUnitId.values()) {
        if (entry.sourceCount > 1) {
            mergeLog.push({
                unit_id:             entry.unitId,
                action:              'units_merged',
                sourceEntriesMerged: entry.sourceCount,
                fieldsCombined:      [...entry.domains.keys()],
                rulesDeduped:        0, // rules are synthesised from domain types at emit time, not taken from raw source blocks
            });
        }
    }

    // Return units sorted by unit_id for deterministic output.
    const mergedUnits = [...byUnitId.values()].sort((a, b) => a.unitId - b.unitId);
    return { mergedUnits, mergeLog };
}

function toMmaYaml(model) {
    // MMA runtime config generated from Memory tab ports.
    // Format per docs/sample yaml/mma.yaml:
    //   - top-level listeners: array
    //   - each listener has id, listen (":PORT"), and memory
    //   - memory is a list of unit entries with unit_id, one or more domain
    //     sections (holding_registers / input_registers / coils / discrete_inputs),
    //     and a policy block.
    //
    // Source priority:
    //   1. port.units[] — manually configured unit/area tree (Memory Tab editor)
    //   2. port.blocks[] — auto-derived from device reads (legacy/fallback)
    //
    // unit_id is a CONTAINER ID.  Multiple entries sharing the same unit_id on
    // the same port are merged by compileMma2Config before YAML emission.
    const memoryPorts = (model.memory && model.memory.ports) || [];

    if (memoryPorts.length === 0) {
        return { yaml: 'listeners: []\n', mergeLog: [] };
    }

    // Pre-compute status memory requirements from devices:
    //   statusByPort: portNum → Map<statusUnitId, deviceCount>
    // Status blocks are sized as device_count × STATUS_SLOT_SIZE registers, starting at address 0.
    const statusByPort = {};
    for (const device of (model.devices || [])) {
        if (device.status_unit_id == null) continue;
        const targetPort = endpointPort(device.target_endpoint);
        if (!targetPort) continue;
        if (!statusByPort[targetPort]) statusByPort[targetPort] = new Map();
        const suid = Number(device.status_unit_id);
        statusByPort[targetPort].set(suid, (statusByPort[targetPort].get(suid) || 0) + 1);
    }

    const lines = ['listeners:'];
    const allMergeLog = [];

    for (let pi = 0; pi < memoryPorts.length; pi++) {
        const port = memoryPorts[pi];
        const portNum = Number(port.port) || 502;
        // First listener is named "main" (matches sample YAML convention); additional
        // listeners use port-based IDs to stay unique.
        const listenerId = pi === 0 ? 'main' : `port-${portNum}`;
        lines.push(`  - id: ${listenerId}`);
        lines.push(`    listen: ":${portNum}"`);
        lines.push(`    memory:`);

        const statusMap = statusByPort[portNum] || new Map();

        // Determine source: use units[] when manually configured, fall back to blocks[]
        const hasManualUnits = (port.units || []).length > 0;
        let blocksForCompile;
        // Build maps from unit_id → state_sealing / policy for manual units (first match wins).
        const stateSealingByUnitId = {};
        const policyByUnitId = {};
        if (hasManualUnits) {
            // Flatten units[] → blocks format for compileMma2Config
            blocksForCompile = (port.units || []).flatMap(u => {
                if (u.state_sealing && !(u.unit_id in stateSealingByUnitId)) {
                    stateSealingByUnitId[u.unit_id] = u.state_sealing;
                }
                if (u.policy && !(u.unit_id in policyByUnitId)) {
                    policyByUnitId[u.unit_id] = u.policy;
                }
                return (u.areas || []).map(a => ({
                    unit_id: u.unit_id,
                    area: a.type || 'holding_registers',
                    address: a.start,
                    count: a.count,
                }));
            });
        } else {
            // Fall back to auto-derived blocks from device reads
            blocksForCompile = port.blocks || [];
        }

        // Run the MMA2 compiler: group + merge all blocks for this port.
        const { mergedUnits, mergeLog } = compileMma2Config(blocksForCompile, statusMap);
        for (const entry of mergeLog) {
            allMergeLog.push({ listener: listenerId, port: portNum, ...entry });
        }

        if (mergedUnits.length === 0) {
            lines.push(`      []`);
        } else {
            for (const unit of mergedUnits) {
                lines.push(`      - unit_id: ${unit.unitId}`);

                // Emit each domain section present in this unit.
                for (const [area, range] of unit.domains) {
                    lines.push(`        ${area}:`);
                    lines.push(`          start: ${range.start}`);
                    lines.push(`          count: ${range.count}`);
                }

                // Emit state_sealing if configured on this unit.
                const ss = stateSealingByUnitId[unit.unitId];
                if (ss && ss.area === 'coil') {
                    lines.push(`        state_sealing:`);
                    lines.push(`          area: coil`);
                    lines.push(`          address: ${ss.address}`);
                }

                // Emit policy.  When user has configured a custom policy, use it.
                // Otherwise auto-generate: status units are read-write, regular
                // units are read-only with the union of read FCs for all domains.
                const customPolicy = policyByUnitId[unit.unitId];
                if (customPolicy) {
                    lines.push(`        policy:`);
                    lines.push(`          rules:`);
                    for (const rule of (customPolicy.rules || [])) {
                        lines.push(`            - id: ${rule.id}`);
                        lines.push(`              source_ip:`);
                        for (const ip of rule.source_ip) {
                            lines.push(`                - ${ip}`);
                        }
                        lines.push(`              allow_fc: [${rule.allow_fc.join(', ')}]`);
                    }
                } else {
                    lines.push(`        policy:`);
                    lines.push(`          rules:`);
                    if (unit.isStatus) {
                        lines.push(`            - id: read-write`);
                        lines.push(`              source_ip:`);
                        lines.push(`                - 0.0.0.0/0`);
                        lines.push(`                - ::/0`);
                        lines.push(`              allow_fc: [3, 16]`);
                    } else {
                        const fcs = [...new Set(
                            [...unit.domains.keys()].map(domainReadFc)
                        )].sort((a, b) => a - b);
                        lines.push(`            - id: read-only`);
                        lines.push(`              source_ip:`);
                        lines.push(`                - 0.0.0.0/0`);
                        lines.push(`                - ::/0`);
                        lines.push(`              allow_fc: [${fcs.join(', ')}]`);
                    }
                }
            }
        }
    }
    return { yaml: lines.join('\n') + '\n', mergeLog: allMergeLog };
}

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

// MMA config must contain ONLY runtime listener definitions — no orchestration data.
// Format: top-level listeners: block with memory definitions per unit.
function validateMmaConfig(yaml) {
    const errors = [];
    if (!/^listeners\s*:/m.test(yaml)) {
        errors.push('MMA config must have a top-level listeners block — use listeners: format');
    }
    if (/^replicator\s*:/m.test(yaml)) {
        errors.push('MMA config must not contain a replicator block — that belongs in Replicator config');
    }
    if (/^routes\s*:/m.test(yaml)) {
        errors.push('MMA config must not contain routes — routes belong in Replicator config');
    }
    if (/\bdevice_id\s*:/m.test(yaml)) {
        errors.push('MMA config must not contain device_id — device references belong in Replicator config');
    }
    if (/\bread_id\s*:/m.test(yaml)) {
        errors.push('MMA config must not contain read_id — read references belong in Replicator config');
    }
    if (/\bblock_id\s*:/m.test(yaml)) {
        errors.push('MMA config must not contain block_id — block references belong in Replicator config');
    }

    // NOTE: duplicate unit_id values within a listener are intentional — unit_id is a
    // CONTAINER ID that may hold multiple memory domains.  compileMma2Config merges them
    // before YAML emission, so duplicates in hand-crafted YAML are left to the runtime.

    return errors;
}

// Replicator config must contain orchestration data only — no MMA listener/memory definitions.
// Format: top-level replicator: block with units list.
function validateReplicatorConfig(yaml) {
    const errors = [];
    if (!/^replicator\s*:/m.test(yaml)) {
        errors.push('Replicator config must have a top-level replicator block — use replicator: format');
    }
    if (/^listeners\s*:/m.test(yaml)) {
        errors.push('Replicator config must not contain a top-level listeners block — listeners belong in MMA config');
    }
    if (/^memory\s*:/m.test(yaml)) {
        errors.push('Replicator config must not contain a top-level memory block — memory definitions belong in MMA config');
    }
    return errors;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /version — return application identity (version, docker digest, git SHA)
app.get('/version', (req, res) => {
    res.json({ version: APP_VERSION, digest: DOCKER_DIGEST, gitSha: GIT_SHA });
});

// GET /model — return full model
app.get('/model', (req, res) => {
    try {
        res.json(readModel());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /model/snapshot — single canonical response combining model + compiled YAML.
//
// This is the endpoint that ALL views must use for their primary data load.
// Returning model and compiled configs in one response guarantees they come
// from the same canonical version — there is no window where the Memory Tab
// could show a model that is ahead of or behind the Config Viewer's YAML.
//
// Response shape:
//   { model, canonicalVersion, config: { replicator: string|null, mma: string|null } }
// Rate-limited (same policy as /validate) because each response includes two
// file system reads for the compiled YAML files.
app.get('/model/snapshot', rateLimit, (req, res) => {
    try {
        // Flush any pending debounced compile so the snapshot always returns
        // YAML that matches the current model.  Without this, a rapid
        // mutation + snapshot sequence would read stale YAML from disk while
        // the Config Viewer already shows the new Memory-tab state.
        if (_compilePending) {
            if (_compileTimer) {
                clearTimeout(_compileTimer);
                _compileTimer = null;
            }
            _compilePending = false;
            autoCompile(readModel());
        }
        const model = readModel();
        const replicatorYaml = fs.existsSync(REPLICATOR_CONFIG_PATH)
            ? fs.readFileSync(REPLICATOR_CONFIG_PATH, 'utf-8')
            : null;
        const mmaYaml = fs.existsSync(MMA_CONFIG_PATH)
            ? fs.readFileSync(MMA_CONFIG_PATH, 'utf-8')
            : null;
        res.json({
            model,
            canonicalVersion: _canonicalVersion,
            config: { replicator: replicatorYaml, mma: mmaYaml },
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /device — add device
app.post('/device', (req, res) => {
    try {
        const { device } = req.body;
        if (!device) {
            return res.status(400).json({ error: 'device is required' });
        }
        if (!isValidEndpoint(device.source_endpoint)) {
            return res.status(400).json({ error: 'device.source_endpoint must be a valid endpoint (e.g. 10.0.0.1:502 or mydevice:502)' });
        }
        if (!isValidEndpoint(device.target_endpoint)) {
            return res.status(400).json({ error: 'device.target_endpoint must be a valid endpoint (e.g. mma2:501)' });
        }
        const unitId = Number(device.unitId);
        if (!Number.isFinite(unitId) || unitId < 0) {
            return res.status(400).json({ error: 'device.unitId must be a non-negative integer (MMA unit ID)' });
        }
        const sourceUnitId = Number(device.source_unit_id);
        if (!isRequiredNonNegativeInt(device.source_unit_id)) {
            return res.status(400).json({ error: 'device.source_unit_id is required and must be a non-negative integer' });
        }
        const model = readModel();

        if (device.groupId) {
            if (!findGroup(model, device.groupId)) {
                return res.status(400).json({ error: `Group "${device.groupId}" not found` });
            }
        }

        const generatedId = `device_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

        // status_slot is system-assigned — the lowest available slot within the same target_endpoint group.
        // status_unit_id is system-managed (not user-editable) and defaults to null for
        // all new devices.  The memory reconciliation flow assigns status_unit_id when
        // status memory is provisioned for this device.
        const newDevice = {
            id: generatedId,
            name: device.name || '',
            groupId: device.groupId || null,
            source_endpoint: device.source_endpoint.trim(),
            source_unit_id: sourceUnitId,
            target_endpoint: device.target_endpoint.trim(),
            unitId,
            status_slot: assignNextSlot(model, device.target_endpoint.trim()),
            status_unit_id: null,
            reads: []
        };
        model.devices.push(newDevice);
        ensureTargetMemory(model, newDevice);
        writeModel(model);
        scheduleCompile();

        res.status(201).json({ ok: true, id: generatedId, unitId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /device/:id — update editable device fields (name, group, source_endpoint, target_endpoint, source_unit_id, unitId)
app.put('/device/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { device } = req.body;
        if (!device) {
            return res.status(400).json({ error: 'device is required' });
        }
        const model = readModel();
        const existing = findDevice(model, id);
        if (!existing) {
            return res.status(404).json({ error: `Device ${id} not found` });
        }
        if (device.source_endpoint !== undefined) {
            if (!isValidEndpoint(device.source_endpoint)) {
                return res.status(400).json({ error: 'device.source_endpoint must be a valid endpoint (e.g. 10.0.0.1:502 or mydevice:502)' });
            }
            existing.source_endpoint = device.source_endpoint.trim();
        }
        if (device.target_endpoint !== undefined) {
            if (!isValidEndpoint(device.target_endpoint)) {
                return res.status(400).json({ error: 'device.target_endpoint must be a valid endpoint (e.g. mma2:501)' });
            }
            existing.target_endpoint = device.target_endpoint.trim();
        }
        if (device.unitId !== undefined) {
            const unitId = Number(device.unitId);
            if (!Number.isFinite(unitId) || unitId < 0) {
                return res.status(400).json({ error: 'device.unitId must be a non-negative integer (MMA unit ID)' });
            }
            existing.unitId = unitId;
        }
        if (device.name !== undefined) existing.name = device.name;
        if (device.groupId !== undefined) {
            if (device.groupId && !findGroup(model, device.groupId)) {
                return res.status(400).json({ error: `Group "${device.groupId}" not found` });
            }
            existing.groupId = device.groupId || null;
        }
        if (device.source_unit_id !== undefined) existing.source_unit_id = Number(device.source_unit_id);
        // status_slot and status_unit_id are system-controlled — ignored if present in body.
        // Ensure memory is allocated whenever target-related fields change (target_endpoint
        // or unitId).  This prevents drift when the user edits a device's destination
        // after initial creation — the old allocation may become orphaned, but the new
        // one is guaranteed to exist.
        if (device.target_endpoint !== undefined || device.unitId !== undefined) {
            ensureTargetMemory(model, existing);
        }
        writeModel(model);
        scheduleCompile();
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /device/:id — remove device
app.delete('/device/:id', (req, res) => {
    try {
        const { id } = req.params;
        const model = readModel();

        const idx = (model.devices || []).findIndex(d => d.id === id);
        if (idx === -1) {
            return res.status(404).json({ error: `Device ${id} not found` });
        }

        model.devices.splice(idx, 1);
        writeModel(model);
        scheduleCompile();
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /device/:id/duplicate — duplicate a device with a unique name and source_unit_id
app.post('/device/:id/duplicate', (req, res) => {
    try {
        const { id } = req.params;
        const model = readModel();
        const orig = findDevice(model, id);
        if (!orig) {
            return res.status(404).json({ error: `Device ${id} not found` });
        }

        // Generate a unique name with an incremental _N suffix.
        // Strip any existing _N suffix from the base name, then probe _1, _2, … until free.
        const existingNames = new Set((model.devices || []).map(d => d.name || ''));
        const baseName = orig.name || '';
        const baseWithoutSuffix = baseName.replace(/_(\d+)$/, '');
        let newName = baseName;
        let n = 1;
        while (existingNames.has(newName)) {
            newName = `${baseWithoutSuffix}_${n}`;
            n++;
        }

        // Find the next free source_unit_id (increment from original until no collision).
        const usedSourceUnitIds = new Set((model.devices || []).map(d => d.source_unit_id));
        let newSourceUnitId = (Number(orig.source_unit_id) || 0) + 1;
        while (usedSourceUnitIds.has(newSourceUnitId)) newSourceUnitId++;

        // Find the next free target_unit_id / unitId (increment from original until no collision).
        let newUnitId = (Number(orig.unitId) || 0) + 1;
        while (_idx.devicesByUnitId.has(newUnitId)) newUnitId++;

        // Find the next free target_endpoint by incrementing the port number.
        // newUnitId is already globally unique so (origPort+1, newUnitId) is
        // guaranteed to be conflict-free; the while loop is a defensive guard.
        const origTarget = orig.target_endpoint || '';
        const targetColonIdx = origTarget.lastIndexOf(':');
        const targetHost = targetColonIdx > 0 ? origTarget.slice(0, targetColonIdx) : null;
        const parsedOrigPort = targetColonIdx > 0 ? Number(origTarget.slice(targetColonIdx + 1)) : NaN;
        let newTargetEndpoint = origTarget; // fallback: keep original if unparseable
        if (targetHost && Number.isFinite(parsedOrigPort)) {
            let newTargetPort = parsedOrigPort + 1;
            while (_idx.devicesByTarget.has(`${targetHost}:${newTargetPort}|${newUnitId}`)) newTargetPort++;
            newTargetEndpoint = `${targetHost}:${newTargetPort}`;
        }

        // Deep-copy reads so the new device shares no references with the original.
        const newReads = JSON.parse(JSON.stringify(orig.reads || []));

        const generatedId = `device_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
        const newDevice = {
            id: generatedId,
            name: newName,
            groupId: orig.groupId || null,
            source_endpoint: orig.source_endpoint,
            source_unit_id: newSourceUnitId,
            target_endpoint: newTargetEndpoint,
            unitId: newUnitId,
            // status_slot is NOT copied from the original — it must be reallocated
            // via the FIX flow (POST /yaml-integrity/fix) so the system assigns the
            // correct slot within the new endpoint group without copying stale state.
            // status_unit_id is system-managed and starts as null for all new devices.
            status_slot: null,
            status_unit_id: null,
            reads: newReads,
        };

        model.devices.push(newDevice);
        ensureTargetMemory(model, newDevice);
        writeModel(model);
        scheduleCompile();

        res.status(201).json({ ok: true, id: generatedId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /system — return current system settings
app.get('/system', (req, res) => {
    try {
        const model = readModel();
        const defaultMmaPort = (model.memory && model.memory.ports && model.memory.ports[0] && Number(model.memory.ports[0].port)) || 502;
        res.json({ system: model.system || {}, defaultMmaEndpoint: TARGET_HOST, defaultMmaPort });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /system — update system settings (generic merge)
app.put('/system', (req, res) => {
    try {
        const { system } = req.body;
        if (!system) {
            return res.status(400).json({ error: 'system is required' });
        }
        const model = readModel();
        model.system = { ...model.system, ...system };
        writeModel(model);
        scheduleCompile();
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /config/save — unified save: device source+target config and system MMA endpoint in one atomic call
app.post('/config/save', (req, res) => {
    try {
        const { deviceId, sourceConfig, targetConfig, mmaEndpointConfig } = req.body;

        // Validate Source Unit ID — required
        const rawSourceUnitId = sourceConfig && sourceConfig.source_unit_id;
        if (!isRequiredNonNegativeInt(rawSourceUnitId)) {
            return res.status(400).json({ error: 'sourceConfig.source_unit_id is required and must be a non-negative integer' });
        }
        const sourceUnitIdNum = Number(rawSourceUnitId);

        // Validate source endpoint
        if (!sourceConfig || !isValidEndpoint(sourceConfig.source_endpoint)) {
            return res.status(400).json({ error: 'sourceConfig.source_endpoint must be a valid endpoint (e.g. 10.0.0.1:502)' });
        }

        // Validate target endpoint
        if (!targetConfig || !isValidEndpoint(targetConfig.target_endpoint)) {
            return res.status(400).json({ error: 'targetConfig.target_endpoint must be a valid endpoint (e.g. mma2:501)' });
        }

        // Validate target unit ID
        const targetUnitId = Number(targetConfig.unitId);
        if (!Number.isFinite(targetUnitId) || targetUnitId < 0) {
            return res.status(400).json({ error: 'targetConfig.unitId must be a non-negative integer' });
        }

        const model = readModel();

        // Update device source + target
        if (deviceId) {
            const existing = findDevice(model, deviceId);
            if (!existing) {
                return res.status(404).json({ error: `Device ${deviceId} not found` });
            }

            existing.source_endpoint = sourceConfig.source_endpoint.trim();
            existing.source_unit_id = sourceUnitIdNum;
            if (sourceConfig.name !== undefined) existing.name = sourceConfig.name;
            if (sourceConfig.groupId !== undefined) {
                if (sourceConfig.groupId && !findGroup(model, sourceConfig.groupId)) {
                    return res.status(400).json({ error: `Group "${sourceConfig.groupId}" not found` });
                }
                existing.groupId = sourceConfig.groupId || null;
            }
            // status_slot and status_unit_id are system-controlled — ignored if present in body.

            existing.target_endpoint = targetConfig.target_endpoint.trim();
            existing.unitId = targetUnitId;
        }

        // Update system MMA endpoint
        if (mmaEndpointConfig !== undefined) {
            model.system = { ...model.system, mma_endpoint: mmaEndpointConfig || null };
        }

        // Slot commit point: assign any missing slots (gap-filling, no reshuffling).
        const { modified: slotsModified } = recompileStatusSlots(model);
        if (slotsModified) {
            console.log('[config/save] Assigned missing status slots via recompileStatusSlots()');
        }

        writeModel(model);
        scheduleCompile();
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// Memory port + block CRUD
// ---------------------------------------------------------------------------

function findMemoryPort(model, portId) {
    return _idx.portsById.get(portId) || null;
}

// POST /memory/port — add a memory port (MMA listener)
app.post('/memory/port', (req, res) => {
    try {
        const { port } = req.body;
        const portNum = Number(port && port.port);
        if (!Number.isFinite(portNum) || portNum < 1 || portNum > 65535) {
            return res.status(400).json({ error: 'port.port must be a valid port number (1–65535)' });
        }
        const model = readModel();
        const exists = _idx.portsByNumber.has(portNum);
        if (exists) {
            return res.status(409).json({ error: `Memory port ${portNum} already exists` });
        }
        // Blocks are always derived from device reads via rehydrateFromYaml —
        // the port starts empty and autoCompile will populate blocks from reads.
        // units[] is the new manual configuration layer for the Memory Tab editor.
        const newPort = {
            id: randomUUID(),
            port: portNum,
            blocks: [],
            units: [],
        };
        model.memory.ports.push(newPort);
        writeModel(model);
        scheduleCompile();
        res.status(201).json({ ok: true, id: newPort.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /memory/port/:id — update a memory port's port number
app.put('/memory/port/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { port } = req.body;
        const portNum = Number(port && port.port);
        if (!Number.isFinite(portNum) || portNum < 1 || portNum > 65535) {
            return res.status(400).json({ error: 'port.port must be a valid port number (1–65535)' });
        }
        const model = readModel();
        const existing = findMemoryPort(model, id);
        if (!existing) {
            return res.status(404).json({ error: `Memory port ${id} not found` });
        }
        const conflict = _idx.portsByNumber.has(portNum) && _idx.portsByNumber.get(portNum).id !== id;
        if (conflict) {
            return res.status(409).json({ error: `Memory port ${portNum} already exists` });
        }
        existing.port = portNum;
        writeModel(model);
        scheduleCompile();
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /memory/port/:id — remove a memory port
app.delete('/memory/port/:id', (req, res) => {
    try {
        const { id } = req.params;
        const model = readModel();
        const idx = model.memory.ports.findIndex(p => p.id === id);
        if (idx === -1) {
            return res.status(404).json({ error: `Memory port ${id} not found` });
        }
        model.memory.ports.splice(idx, 1);
        writeModel(model);
        scheduleCompile();
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// Memory unit + area CRUD (nested under port, units[] layer)
// ---------------------------------------------------------------------------

const VALID_AREA_TYPES = new Set(['holding_registers', 'input_registers', 'coils', 'discrete_inputs']);
const VALID_FC_SET = new Set([1, 2, 3, 4, 5, 6, 15, 16]);

function findUnit(port, unitId) {
    return ((port && port.units) || []).find(u => u.id === unitId) || null;
}

// POST /memory/port/:portId/unit — add a unit to a memory port
app.post('/memory/port/:portId/unit', (req, res) => {
    try {
        const { portId } = req.params;
        const { unit } = req.body;
        const unitIdNum = Number(unit && unit.unit_id);
        if (!Number.isFinite(unitIdNum) || unitIdNum < 0 || unitIdNum > 65535) {
            return res.status(400).json({ error: 'unit.unit_id must be a non-negative integer (0–65535)' });
        }
        const model = readModel();
        const port = findMemoryPort(model, portId);
        if (!port) {
            return res.status(404).json({ error: `Memory port ${portId} not found` });
        }
        const newUnit = { id: randomUUID(), unit_id: unitIdNum, areas: [] };
        port.units.push(newUnit);
        writeModel(model);
        scheduleCompile();
        res.status(201).json({ ok: true, id: newUnit.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /memory/port/:portId/unit/:unitId — update a unit's unit_id and/or state_sealing
app.put('/memory/port/:portId/unit/:unitId', (req, res) => {
    try {
        const { portId, unitId } = req.params;
        const { unit } = req.body;
        if (!unit || typeof unit !== 'object') {
            return res.status(400).json({ error: 'Request body must include a unit object' });
        }

        // Validate unit_id when provided
        let unitIdNum;
        const hasUnitId = 'unit_id' in unit;
        if (hasUnitId) {
            unitIdNum = Number(unit.unit_id);
            if (!Number.isFinite(unitIdNum) || unitIdNum < 0 || unitIdNum > 65535) {
                return res.status(400).json({ error: 'unit.unit_id must be a non-negative integer (0–65535)' });
            }
        }

        // Validate state_sealing when provided
        const hasStateSealing = 'state_sealing' in unit;
        let stateSealingValue;
        if (hasStateSealing) {
            if (unit.state_sealing === null) {
                stateSealingValue = null;
            } else if (unit.state_sealing && typeof unit.state_sealing === 'object') {
                if (unit.state_sealing.area !== 'coil') {
                    return res.status(400).json({ error: 'state_sealing.area must be "coil" (the only supported value)' });
                }
                const addr = Number(unit.state_sealing.address);
                if (!Number.isFinite(addr) || addr < 0) {
                    return res.status(400).json({ error: 'state_sealing.address must be a non-negative integer' });
                }
                stateSealingValue = { area: 'coil', address: addr };
            } else {
                return res.status(400).json({ error: 'state_sealing must be null or an object with area and address' });
            }
        }

        // Validate policy when provided
        const hasPolicy = 'policy' in unit;
        let policyValue;
        if (hasPolicy) {
            if (unit.policy === null) {
                policyValue = null;
            } else if (unit.policy && typeof unit.policy === 'object') {
                if (!Array.isArray(unit.policy.rules)) {
                    return res.status(400).json({ error: 'policy.rules must be an array' });
                }
                const validatedRules = [];
                for (let i = 0; i < unit.policy.rules.length; i++) {
                    const rule = unit.policy.rules[i];
                    if (!rule.id || typeof rule.id !== 'string' || !rule.id.trim()) {
                        return res.status(400).json({ error: `policy rule ${i + 1}: id must be a non-empty string` });
                    }
                    if (!Array.isArray(rule.source_ip) || rule.source_ip.length === 0) {
                        return res.status(400).json({ error: `policy rule ${i + 1}: source_ip must be a non-empty array of strings` });
                    }
                    if (!rule.source_ip.every(ip => typeof ip === 'string' && ip.trim())) {
                        return res.status(400).json({ error: `policy rule ${i + 1}: source_ip entries must be non-empty strings` });
                    }
                    if (!Array.isArray(rule.allow_fc)) {
                        return res.status(400).json({ error: `policy rule ${i + 1}: allow_fc must be an array` });
                    }
                    const invalidFcs = rule.allow_fc.filter(fc => !VALID_FC_SET.has(Number(fc)));
                    if (invalidFcs.length > 0) {
                        return res.status(400).json({ error: `policy rule ${i + 1}: invalid function codes: ${invalidFcs.join(', ')}. Valid codes: 1,2,3,4,5,6,15,16` });
                    }
                    validatedRules.push({
                        id: rule.id.trim(),
                        source_ip: rule.source_ip.map(ip => String(ip).trim()),
                        allow_fc: rule.allow_fc.map(fc => Number(fc)),
                    });
                }
                policyValue = { rules: validatedRules };
            } else {
                return res.status(400).json({ error: 'policy must be null or an object with a rules array' });
            }
        }

        if (!hasUnitId && !hasStateSealing && !hasPolicy) {
            return res.status(400).json({ error: 'unit must include at least one of: unit_id, state_sealing, policy' });
        }

        const model = readModel();
        const port = findMemoryPort(model, portId);
        if (!port) {
            return res.status(404).json({ error: `Memory port ${portId} not found` });
        }
        const existing = findUnit(port, unitId);
        if (!existing) {
            return res.status(404).json({ error: `Unit ${unitId} not found on port ${portId}` });
        }
        if (hasUnitId) existing.unit_id = unitIdNum;
        if (hasStateSealing) {
            if (stateSealingValue === null) {
                delete existing.state_sealing;
            } else {
                existing.state_sealing = stateSealingValue;
            }
        }
        if (hasPolicy) {
            if (policyValue === null) {
                delete existing.policy;
            } else {
                existing.policy = policyValue;
            }
        }
        writeModel(model);
        scheduleCompile();
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /memory/port/:portId/unit/:unitId — remove a unit and all its areas
app.delete('/memory/port/:portId/unit/:unitId', (req, res) => {
    try {
        const { portId, unitId } = req.params;
        const model = readModel();
        const port = findMemoryPort(model, portId);
        if (!port) {
            return res.status(404).json({ error: `Memory port ${portId} not found` });
        }
        const idx = (port.units || []).findIndex(u => u.id === unitId);
        if (idx === -1) {
            return res.status(404).json({ error: `Unit ${unitId} not found on port ${portId}` });
        }
        port.units.splice(idx, 1);
        writeModel(model);
        scheduleCompile();
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /memory/port/:portId/unit/:unitId/area — add an area to a unit
app.post('/memory/port/:portId/unit/:unitId/area', (req, res) => {
    try {
        const { portId, unitId } = req.params;
        const { area } = req.body;
        const areaType = area && area.type;
        if (!VALID_AREA_TYPES.has(areaType)) {
            return res.status(400).json({ error: `area.type must be one of: ${[...VALID_AREA_TYPES].join(', ')}` });
        }
        const start = Number(area.start);
        const count = Number(area.count);
        if (!Number.isFinite(start) || start < 0) {
            return res.status(400).json({ error: 'area.start must be a non-negative integer' });
        }
        if (!Number.isFinite(count) || count < 1) {
            return res.status(400).json({ error: 'area.count must be a positive integer' });
        }
        const model = readModel();
        const port = findMemoryPort(model, portId);
        if (!port) {
            return res.status(404).json({ error: `Memory port ${portId} not found` });
        }
        const unit = findUnit(port, unitId);
        if (!unit) {
            return res.status(404).json({ error: `Unit ${unitId} not found on port ${portId}` });
        }
        // If an area of the same type already exists in this unit, merge ranges
        // (widest range: same algorithm as compileMma2Config) so the model never
        // holds duplicate area types per unit, keeping the memory tab consistent
        // with the generated MMA config.
        const existingArea = (unit.areas || []).find(a => a.type === areaType);
        if (existingArea) {
            const newEnd = Math.max(existingArea.start + existingArea.count - 1, start + count - 1);
            existingArea.start = Math.min(existingArea.start, start);
            existingArea.count = newEnd - existingArea.start + 1;
            writeModel(model);
            scheduleCompile();
            return res.status(200).json({ ok: true, id: existingArea.id, merged: true });
        }
        const newArea = { id: randomUUID(), type: areaType, start, count };
        unit.areas.push(newArea);
        writeModel(model);
        scheduleCompile();
        res.status(201).json({ ok: true, id: newArea.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /memory/port/:portId/unit/:unitId/area/:areaId — update an area
app.put('/memory/port/:portId/unit/:unitId/area/:areaId', (req, res) => {
    try {
        const { portId, unitId, areaId } = req.params;
        const { area } = req.body;
        if (!area) {
            return res.status(400).json({ error: 'area is required' });
        }
        const model = readModel();
        const port = findMemoryPort(model, portId);
        if (!port) {
            return res.status(404).json({ error: `Memory port ${portId} not found` });
        }
        const unit = findUnit(port, unitId);
        if (!unit) {
            return res.status(404).json({ error: `Unit ${unitId} not found on port ${portId}` });
        }
        const existing = (unit.areas || []).find(a => a.id === areaId);
        if (!existing) {
            return res.status(404).json({ error: `Area ${areaId} not found on unit ${unitId}` });
        }
        if (area.type !== undefined) {
            if (!VALID_AREA_TYPES.has(area.type)) {
                return res.status(400).json({ error: `area.type must be one of: ${[...VALID_AREA_TYPES].join(', ')}` });
            }
            // If the new type already exists in another area of this unit, merge ranges
            // (widest range) into that area and remove this one to maintain uniqueness per type.
            if (area.type !== existing.type) {
                const duplicate = (unit.areas || []).find(a => a.id !== areaId && a.type === area.type);
                if (duplicate) {
                    const newEnd = Math.max(duplicate.start + duplicate.count - 1, existing.start + existing.count - 1);
                    duplicate.start = Math.min(duplicate.start, existing.start);
                    duplicate.count = newEnd - duplicate.start + 1;
                    unit.areas = unit.areas.filter(a => a.id !== areaId);
                    writeModel(model);
                    scheduleCompile();
                    return res.json({ ok: true, id: duplicate.id, merged: true });
                }
            }
            existing.type = area.type;
        }
        if (area.start !== undefined) {
            const start = Number(area.start);
            if (!Number.isFinite(start) || start < 0) {
                return res.status(400).json({ error: 'area.start must be a non-negative integer' });
            }
            existing.start = start;
        }
        if (area.count !== undefined) {
            const count = Number(area.count);
            if (!Number.isFinite(count) || count < 1) {
                return res.status(400).json({ error: 'area.count must be a positive integer' });
            }
            existing.count = count;
        }
        writeModel(model);
        scheduleCompile();
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /memory/port/:portId/unit/:unitId/area/:areaId — remove an area from a unit
app.delete('/memory/port/:portId/unit/:unitId/area/:areaId', (req, res) => {
    try {
        const { portId, unitId, areaId } = req.params;
        const model = readModel();
        const port = findMemoryPort(model, portId);
        if (!port) {
            return res.status(404).json({ error: `Memory port ${portId} not found` });
        }
        const unit = findUnit(port, unitId);
        if (!unit) {
            return res.status(404).json({ error: `Unit ${unitId} not found on port ${portId}` });
        }
        const idx = (unit.areas || []).findIndex(a => a.id === areaId);
        if (idx === -1) {
            return res.status(404).json({ error: `Area ${areaId} not found on unit ${unitId}` });
        }
        unit.areas.splice(idx, 1);
        writeModel(model);
        scheduleCompile();
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /memory/port/:portId/units/populate — auto-populate units[] from current device reads
// Derives unit structure from auto-computed blocks[], grouping areas by unit_id.
// Existing manually-defined units are merged/preserved — duplicate unit_ids are merged.
app.post('/memory/port/:portId/units/populate', (req, res) => {
    try {
        const { portId } = req.params;
        const model = readModel();
        const port = findMemoryPort(model, portId);
        if (!port) {
            return res.status(404).json({ error: `Memory port ${portId} not found` });
        }

        // Build a map of existing units by unit_id to preserve manual edits
        const existingByUnitId = new Map();
        for (const u of (port.units || [])) {
            existingByUnitId.set(u.unit_id, u);
        }

        // Derive new units from blocks[] (auto-computed from device reads)
        const derivedByUnitId = new Map();
        for (const block of (port.blocks || [])) {
            const uid = Number(block.unit_id);
            if (!derivedByUnitId.has(uid)) {
                derivedByUnitId.set(uid, []);
            }
            derivedByUnitId.get(uid).push({
                id: randomUUID(),
                type: block.area || 'holding_registers',
                start: block.address,
                count: block.count,
            });
        }

        let added = 0;
        for (const [uid, areas] of derivedByUnitId) {
            if (existingByUnitId.has(uid)) {
                // Merge areas into existing unit.  Check uniqueness by type only — if a
                // derived area has the same type as an existing one but a different range,
                // widen the existing area to cover both.  This keeps the model at most one
                // area per type per unit, matching the YAML compiler (compileMma2Config)
                // and preventing the Memory tab from showing a different layout than the
                // generated config.
                const existing = existingByUnitId.get(uid);
                for (const area of areas) {
                    const existingArea = (existing.areas || []).find(a => a.type === area.type);
                    if (existingArea) {
                        const newEnd = Math.max(
                            existingArea.start + existingArea.count - 1,
                            area.start + area.count - 1
                        );
                        existingArea.start = Math.min(existingArea.start, area.start);
                        existingArea.count = newEnd - existingArea.start + 1;
                    } else {
                        existing.areas.push(area);
                        added++;
                    }
                }
            } else {
                // Create new unit from derived blocks
                const newUnit = { id: randomUUID(), unit_id: uid, areas };
                port.units.push(newUnit);
                added += areas.length;
            }
        }

        writeModel(model);
        scheduleCompile();
        res.json({ ok: true, unitsCount: port.units.length, areasAdded: added });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// Memory Reconciliation — diagnostic + corrective tool (no runtime impact)
// ---------------------------------------------------------------------------

// GET /memory/reconcile — compare replicator device configs vs memory registry
// Returns { missing, orphaned, valid, area_mismatch } lists.  Read-only; never mutates model.
app.get('/memory/reconcile', (req, res) => {
    try {
        const model = readModel();
        const devices = model.devices || [];
        const ports = (model.memory && model.memory.ports) || [];

        // Build lookup: portNum → { portId, unitSet: Map<unit_id → unit> }
        const portMap = new Map();
        for (const port of ports) {
            const portNum = Number(port.port);
            const unitMap = new Map();
            for (const unit of (port.units || [])) {
                unitMap.set(Number(unit.unit_id), unit);
            }
            portMap.set(portNum, { portId: port.id, units: unitMap });
        }

        const missing = [];
        const valid = [];
        const area_mismatch = [];
        // Track units that are accounted for by a device
        const accountedUnits = new Set(); // key: `${portId}:${unit.id}`

        for (const device of devices) {
            const portNum = endpointPort(device.target_endpoint);
            const unitId = Number(device.unitId);
            if (portNum == null || !Number.isFinite(unitId) || unitId < 0) continue;

            const portEntry = portMap.get(portNum);
            const unit = portEntry && portEntry.units.get(unitId);

            if (!unit) {
                missing.push({
                    device: {
                        id: device.id,
                        name: device.name,
                        unitId: device.unitId,
                        target_endpoint: device.target_endpoint,
                        status_slot: device.status_slot,
                        status_unit_id: device.status_unit_id,
                    },
                    portNum,
                    portId: portEntry ? portEntry.portId : null,
                });
            } else {
                accountedUnits.add(`${portEntry.portId}:${unit.id}`);

                // Determine the area types required by this device's reads.
                const requiredAreas = new Set();
                for (const read of (device.reads || [])) {
                    requiredAreas.add(read.source_area || 'holding_registers');
                }

                // Determine the area types configured in the unit.
                const configuredAreas = new Set((unit.areas || []).map(a => a.type));

                // Find area types required by the device but absent from the unit.
                const missingAreas = [...requiredAreas].filter(a => !configuredAreas.has(a));

                // For area types that are present, check that each read's address range
                // is actually covered by the unit area (start <= readStart, start+count >= readEnd).
                const rangeIssues = [];
                for (const read of (device.reads || [])) {
                    const areaType = read.source_area || 'holding_registers';
                    if (!configuredAreas.has(areaType)) continue; // already flagged as missing
                    const readStart = Number(read.source_address);
                    const readCount = Number(read.source_count) || 1;
                    const readEnd = readStart + readCount - 1;
                    const matchingAreas = (unit.areas || []).filter(a => a.type === areaType);
                    const covered = matchingAreas.some(a => {
                        const aStart = Number(a.start);
                        const aEnd = aStart + Number(a.count) - 1;
                        return aStart <= readStart && aEnd >= readEnd;
                    });
                    if (!covered) {
                        const bestArea = matchingAreas[0] || null;
                        rangeIssues.push({
                            readId: read.id,
                            readName: read.name || read.id,
                            areaType,
                            readStart,
                            readEnd,
                            areaStart: bestArea != null ? Number(bestArea.start) : null,
                            areaEnd: bestArea != null ? Number(bestArea.start) + Number(bestArea.count) - 1 : null,
                            areaCount: bestArea != null ? Number(bestArea.count) : null,
                        });
                    }
                }

                const deviceSummary = {
                    id: device.id,
                    name: device.name,
                    unitId: device.unitId,
                    target_endpoint: device.target_endpoint,
                    status_slot: device.status_slot,
                    status_unit_id: device.status_unit_id,
                };
                const unitSummary = { id: unit.id, unit_id: unit.unit_id, areas: unit.areas || [] };

                if (missingAreas.length > 0 || rangeIssues.length > 0) {
                    area_mismatch.push({
                        device: deviceSummary,
                        unit: unitSummary,
                        portId: portEntry.portId,
                        portNum,
                        missingAreas,
                        configuredAreas: [...configuredAreas],
                        requiredAreas: [...requiredAreas],
                        rangeIssues,
                    });
                } else {
                    valid.push({
                        device: deviceSummary,
                        unit: unitSummary,
                        portId: portEntry.portId,
                        portNum,
                    });
                }
            }
        }

        // Collect orphaned: units not matched by any device
        const orphaned = [];
        for (const port of ports) {
            const portNum = Number(port.port);
            for (const unit of (port.units || [])) {
                if (!accountedUnits.has(`${port.id}:${unit.id}`)) {
                    orphaned.push({
                        unit: { id: unit.id, unit_id: unit.unit_id, areas: unit.areas || [] },
                        portId: port.id,
                        portNum,
                    });
                }
            }
        }

        // -------------------------------------------------------------------
        // Status memory checks
        // For each unique (targetPort, status_unit_id) group, verify that
        // the port has a unit with the right holding_registers allocation:
        //   start = 0, count = deviceCount * STATUS_SLOT_SIZE
        // -------------------------------------------------------------------
        // Build a map: `${portNum}:${status_unit_id}` → { portNum, statusUnitId, devices[] }
        const statusGroups = new Map();
        for (const device of devices) {
            if (device.status_unit_id == null) continue;
            const portNum = endpointPort(device.target_endpoint);
            if (portNum == null) continue;
            const suid = Number(device.status_unit_id);
            const key = `${portNum}:${suid}`;
            if (!statusGroups.has(key)) {
                statusGroups.set(key, { portNum, statusUnitId: suid, devices: [] });
            }
            statusGroups.get(key).devices.push({
                id: device.id,
                name: device.name,
                status_slot: device.status_slot,
                unitId: device.unitId,
            });
        }

        const status_missing = [];
        const status_size_mismatch = [];

        for (const { portNum, statusUnitId, devices: groupDevices } of statusGroups.values()) {
            const deviceCount = groupDevices.length;
            const requiredCount = deviceCount * STATUS_SLOT_SIZE;

            const portEntry = portMap.get(portNum);
            const unit = portEntry && portEntry.units.get(statusUnitId);

            if (!unit) {
                // Port or unit is absent — status memory needs to be created.
                status_missing.push({
                    statusUnitId,
                    portNum,
                    portId: portEntry ? portEntry.portId : null,
                    deviceCount,
                    requiredCount,
                    devices: groupDevices,
                });
            } else {
                // Unit exists — check that it has a holding_registers area at start=0
                // with count >= requiredCount.
                const hrAreas = (unit.areas || []).filter(a => a.type === 'holding_registers');
                const hrArea = hrAreas[0] || null;
                const configuredStart = hrArea != null ? Number(hrArea.start) : null;
                const configuredCount = hrArea != null ? Number(hrArea.count) : null;
                const sizeOk = hrArea != null && configuredStart === 0 && configuredCount >= requiredCount;
                if (!sizeOk) {
                    status_size_mismatch.push({
                        statusUnitId,
                        portNum,
                        portId: portEntry.portId,
                        unitDbId: unit.id,
                        deviceCount,
                        requiredCount,
                        configuredStart,
                        configuredCount,
                        devices: groupDevices,
                    });
                }
            }
        }

        res.json({ missing, orphaned, valid, area_mismatch, status_missing, status_size_mismatch, status_slot_size: STATUS_SLOT_SIZE });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /memory/reconcile/fix-status — create or correct a status memory unit.
// For the given (status_unit_id, port_num) group this endpoint finds or creates
// the target memory port + unit and sets its holding_registers area to
// start=0, count=deviceCount*STATUS_SLOT_SIZE.
// Body: { status_unit_id, port_num }
app.post('/memory/reconcile/fix-status', (req, res) => {
    try {
        const { status_unit_id, port_num } = req.body;
        const statusUnitId = Number(status_unit_id);
        const portNum = Number(port_num);
        if (!Number.isFinite(statusUnitId) || statusUnitId < 0) {
            return res.status(400).json({ error: 'status_unit_id is required and must be a non-negative integer' });
        }
        if (!Number.isFinite(portNum) || portNum < 1) {
            return res.status(400).json({ error: 'port_num is required and must be a positive integer' });
        }

        const model = readModel();
        const devices = model.devices || [];

        // Count devices in this (port, status_unit_id) group.
        const deviceCount = devices.filter(d =>
            d.status_unit_id != null &&
            Number(d.status_unit_id) === statusUnitId &&
            endpointPort(d.target_endpoint) === portNum
        ).length;

        if (deviceCount === 0) {
            return res.status(404).json({ error: `No devices found with status_unit_id ${statusUnitId} targeting port ${portNum}` });
        }

        const requiredCount = deviceCount * STATUS_SLOT_SIZE;

        // Find or create the memory port.
        let port = _idx.portsByNumber.get(portNum) || null;
        if (!port) {
            port = { id: randomUUID(), port: portNum, blocks: [], units: [] };
            model.memory.ports.push(port);
            _idx.portsByNumber.set(portNum, port);
            _idx.portsById.set(port.id, port);
        }
        if (!port.units) port.units = [];

        // Find or create the status unit.
        let unit = port.units.find(u => Number(u.unit_id) === statusUnitId);
        if (!unit) {
            unit = { id: randomUUID(), unit_id: statusUnitId, areas: [] };
            port.units.push(unit);
        }
        if (!unit.areas) unit.areas = [];

        // Remove any existing holding_registers areas for this unit.
        unit.areas = unit.areas.filter(a => a.type !== 'holding_registers');

        // Add the correctly-sized holding_registers area.
        unit.areas.push({
            id: randomUUID(),
            type: 'holding_registers',
            start: 0,
            count: requiredCount,
        });

        writeModel(model);
        scheduleCompile();
        res.json({ ok: true, requiredCount });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /memory/reconcile/create — create missing memory allocation for a device
// Body: { device_id }
app.post('/memory/reconcile/create', (req, res) => {
    try {
        const { device_id } = req.body;
        if (!device_id) {
            return res.status(400).json({ error: 'device_id is required' });
        }
        const model = readModel();
        const device = findDevice(model, device_id);
        if (!device) {
            return res.status(404).json({ error: `Device ${device_id} not found` });
        }
        ensureTargetMemory(model, device);
        writeModel(model);
        scheduleCompile();
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /memory/reconcile/fix-areas — fix area ranges for an area-mismatch unit.
// Clears the unit's areas so ensureTargetMemory re-derives them from all device reads,
// correcting any start/count range mismatches.
// Body: { device_id }
app.post('/memory/reconcile/fix-areas', (req, res) => {
    try {
        const { device_id } = req.body;
        if (!device_id) {
            return res.status(400).json({ error: 'device_id is required' });
        }
        const model = readModel();
        const device = findDevice(model, device_id);
        if (!device) {
            return res.status(404).json({ error: `Device ${device_id} not found` });
        }
        const portNum = endpointPort(device.target_endpoint);
        const unitId = Number(device.unitId);
        if (portNum == null || !Number.isFinite(unitId) || unitId < 0) {
            return res.status(400).json({ error: 'Device has invalid target_endpoint or unitId' });
        }
        // Clear the unit's areas so ensureTargetMemory re-derives them from reads,
        // fixing incorrect start/count ranges.
        const port = _idx.portsByNumber.get(portNum);
        if (port) {
            const unit = (port.units || []).find(u => Number(u.unit_id) === unitId);
            if (unit) unit.areas = [];
        }
        ensureTargetMemory(model, device);
        writeModel(model);
        scheduleCompile();
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /read — add read to device, validate no overlap in same area
app.post('/read', (req, res) => {
    try {
        const { device_id, read } = req.body;
        if (!device_id || !read || !read.id) {
            return res.status(400).json({ error: 'device_id and read.id are required' });
        }

        const model = readModel();

        const device = findDevice(model, device_id);
        if (!device) {
            return res.status(404).json({ error: `Device ${device_id} not found` });
        }

        const readExists = device.reads.some(r => r.id === read.id);
        if (readExists) {
            return res.status(409).json({ error: `Read ${read.id} already exists on device ${device_id}` });
        }

        // Apply defaults for target fields — target is always MMA holding registers at address 0
        if (!read.target_area) read.target_area = 'holding_registers';
        if (read.target_address == null) read.target_address = 0;

        for (const existing of device.reads) {
            if (readsOverlap(existing, read)) {
                return res.status(409).json({
                    error: `Read overlaps with existing read ${existing.id} in area ${existing.source_area}`
                });
            }
        }

        device.reads.push(read);
        ensureTargetMemory(model, device);
        writeModel(model);
        scheduleCompile();

        res.status(201).json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /group — add a device group
app.post('/group', (req, res) => {
    try {
        const { group } = req.body;
        if (!group || !group.name || !group.name.trim()) {
            return res.status(400).json({ error: 'group.name is required' });
        }
        const model = readModel();
        const exists = model.groups.some(g => g.name === group.name.trim());
        if (exists) {
            return res.status(409).json({ error: `Group "${group.name.trim()}" already exists` });
        }
        const newGroup = { id: randomUUID(), name: group.name.trim() };
        model.groups.push(newGroup);
        writeModel(model);
        scheduleCompile();
        res.status(201).json({ ok: true, group: newGroup });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /group/:id — rename a group
app.put('/group/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { group } = req.body;
        if (!group || !group.name || !group.name.trim()) {
            return res.status(400).json({ error: 'group.name is required' });
        }
        const model = readModel();
        const existing = findGroup(model, id);
        if (!existing) {
            return res.status(404).json({ error: `Group "${id}" not found` });
        }
        const nameConflict = model.groups.some(g => g.name === group.name.trim() && g.id !== id);
        if (nameConflict) {
            return res.status(409).json({ error: `Group "${group.name.trim()}" already exists` });
        }
        existing.name = group.name.trim();
        writeModel(model);
        scheduleCompile();
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /group/:id — remove group; devices in this group become ungrouped
app.delete('/group/:id', (req, res) => {
    try {
        const { id } = req.params;
        const model = readModel();
        const idx = model.groups.findIndex(g => g.id === id);
        if (idx === -1) {
            return res.status(404).json({ error: `Group "${id}" not found` });
        }
        model.groups.splice(idx, 1);
        for (const device of model.devices) {
            if (device.groupId === id) device.groupId = null;
        }
        writeModel(model);
        scheduleCompile();
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /read/:deviceId/:readId — update an existing read
app.put('/read/:deviceId/:readId', (req, res) => {
    try {
        const { deviceId, readId } = req.params;
        const { read } = req.body;
        if (!read) {
            return res.status(400).json({ error: 'read is required' });
        }
        const model = readModel();
        const device = findDevice(model, deviceId);
        if (!device) {
            return res.status(404).json({ error: `Device ${deviceId} not found` });
        }
        const existing = (device.reads || []).find(r => r.id === readId);
        if (!existing) {
            return res.status(404).json({ error: `Read ${readId} not found on device ${deviceId}` });
        }
        // Check overlap against other reads (not including itself)
        const candidate = { ...existing, ...read };
        for (const r of device.reads) {
            if (r.id === readId) continue;
            if (readsOverlap(r, candidate)) {
                return res.status(409).json({
                    error: `Read overlaps with existing read ${r.id} in area ${r.source_area}`
                });
            }
        }
        if (read.name !== undefined) existing.name = read.name;
        if (read.source_area !== undefined) existing.source_area = read.source_area;
        if (read.source_address !== undefined) existing.source_address = Number(read.source_address);
        if (read.source_count !== undefined) existing.source_count = Number(read.source_count);
        if (read.poll_interval !== undefined) existing.poll_interval = Number(read.poll_interval);
        ensureTargetMemory(model, device);
        writeModel(model);
        scheduleCompile();
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /read/:deviceId/:readId — remove a read from a device
app.delete('/read/:deviceId/:readId', (req, res) => {
    try {
        const { deviceId, readId } = req.params;
        const model = readModel();
        const device = findDevice(model, deviceId);
        if (!device) {
            return res.status(404).json({ error: `Device ${deviceId} not found` });
        }
        const idx = (device.reads || []).findIndex(r => r.id === readId);
        if (idx === -1) {
            return res.status(404).json({ error: `Read ${readId} not found on device ${deviceId}` });
        }
        device.reads.splice(idx, 1);
        ensureTargetMemory(model, device);
        writeModel(model);
        scheduleCompile();
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// GET /read/:deviceId/export-csv — download reads as CSV (read_id excluded)
app.get('/read/:deviceId/export-csv', (req, res) => {
    try {
        const { deviceId } = req.params;
        const model = readModel();
        const device = findDevice(model, deviceId);
        if (!device) {
            return res.status(404).json({ error: `Device ${deviceId} not found` });
        }
        const reads = device.reads || [];
        const header = 'name,source_area,source_address,count,poll_interval_ms';
        const rows = reads.map(r => [
            csvCell(r.name || ''),
            csvCell(r.source_area || ''),
            r.source_address ?? 0,
            r.source_count ?? 1,
            r.poll_interval ?? 1000,
        ].join(','));
        const csv = [header, ...rows].join('\r\n');
        const filename = `reads_${deviceId}.csv`;
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /read/:deviceId/import-csv — import reads from CSV; read IDs are auto-generated
app.post('/read/:deviceId/import-csv', express.text({ type: 'text/plain' }), (req, res) => {
    try {
        const { deviceId } = req.params;
        const csv = req.body;
        if (!csv || typeof csv !== 'string' || !csv.trim()) {
            return res.status(400).json({ error: 'CSV body is required' });
        }

        const model = readModel();
        const device = findDevice(model, deviceId);
        if (!device) {
            return res.status(404).json({ error: `Device ${deviceId} not found` });
        }

        const lines = csv.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) {
            return res.status(400).json({ error: 'CSV must have a header row and at least one data row' });
        }

        const header = parseCSVRow(lines[0]).map(h => h.trim());
        const REQUIRED_COLS = ['name', 'source_area', 'source_address', 'count', 'poll_interval_ms'];
        for (const col of REQUIRED_COLS) {
            if (!header.includes(col)) {
                return res.status(400).json({ error: `CSV missing required column: ${col}` });
            }
        }

        const colIdx = {
            name:            header.indexOf('name'),
            source_area:     header.indexOf('source_area'),
            source_address:  header.indexOf('source_address'),
            count:           header.indexOf('count'),
            poll_interval_ms: header.indexOf('poll_interval_ms'),
        };

        const VALID_AREAS = new Set(['holding_registers', 'coils', 'input_registers', 'discrete_inputs']);
        const imported = [];
        const errors = [];

        for (let i = 1; i < lines.length; i++) {
            const cols = parseCSVRow(lines[i]);
            const name          = (cols[colIdx.name] || '').trim();
            const source_area   = (cols[colIdx.source_area] || '').trim();
            const source_address = Number(cols[colIdx.source_address]);
            const source_count  = Number(cols[colIdx.count]);
            const poll_interval = Number(cols[colIdx.poll_interval_ms]);

            if (!VALID_AREAS.has(source_area)) {
                errors.push(`Row ${i + 1}: invalid source_area "${source_area}"`);
                continue;
            }
            if (!Number.isFinite(source_address) || source_address < 0) {
                errors.push(`Row ${i + 1}: invalid source_address "${cols[colIdx.source_address]}"`);
                continue;
            }
            if (!Number.isFinite(source_count) || source_count < 1) {
                errors.push(`Row ${i + 1}: invalid count "${cols[colIdx.count]}"`);
                continue;
            }
            if (!Number.isFinite(poll_interval) || poll_interval < 100) {
                errors.push(`Row ${i + 1}: invalid poll_interval_ms "${cols[colIdx.poll_interval_ms]}"`);
                continue;
            }

            const id = generateUniqueReadId(device.reads);
            const newRead = {
                id,
                name,
                source_area,
                source_address,
                source_count,
                poll_interval,
                target_area:    'holding_registers',
                target_address: 0,
            };

            const overlap = device.reads.find(r => readsOverlap(r, newRead));
            if (overlap) {
                errors.push(`Row ${i + 1}: overlaps with existing read "${overlap.id}" in area ${source_area}`);
                continue;
            }

            device.reads.push(newRead);
            imported.push(id);
        }

        if (imported.length > 0) {
            ensureTargetMemory(model, device);
            writeModel(model);
            scheduleCompile();
        }

        res.json({ ok: true, imported: imported.length, errors });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /config — return raw YAML snapshots for Config Viewer (read-only)
app.get('/config', (req, res) => {
    try {
        const replicatorYaml = fs.existsSync(REPLICATOR_CONFIG_PATH)
            ? fs.readFileSync(REPLICATOR_CONFIG_PATH, 'utf-8')
            : null;
        const mmaYaml = fs.existsSync(MMA_CONFIG_PATH)
            ? fs.readFileSync(MMA_CONFIG_PATH, 'utf-8')
            : null;
        res.json({ replicator: replicatorYaml, mma: mmaYaml });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// Compile helpers
// ---------------------------------------------------------------------------

/**
 * Merge an array of {start, end} ranges into a minimal sorted list with no
 * overlapping or adjacent ranges. Two ranges are considered adjacent when one
 * ends exactly one before the other begins (e.g. [1,5] and [6,10]), and are
 * merged into a single range [1,10].
 *
 * @param {Array<{start: number, end: number}>} ranges
 * @returns {Array<{start: number, end: number}>}
 */
function mergeRanges(ranges) {
    if (ranges.length === 0) return [];
    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    const result = [{ ...sorted[0] }];
    for (let i = 1; i < sorted.length; i++) {
        const last = result[result.length - 1];
        if (sorted[i].start <= last.end + 1) {
            last.end = Math.max(last.end, sorted[i].end);
        } else {
            result.push({ ...sorted[i] });
        }
    }
    return result;
}

/**
 * Full rehydration: rebuild all memory allocation state from scratch.
 *
 * Derives memory blocks entirely from device reads — no merging with existing
 * blocks, no diff-based updates. Status slot assignments are also recomputed.
 * Every call produces a deterministic, complete snapshot of memory state
 * derived solely from the model.
 *
 * Called on every model mutation and compile to ensure memory always matches
 * the model exactly.
 *
 * @param {object} model
 * @returns {{ modified: boolean, blocksCreated: number }}
 */
function rehydrateFromYaml(model) {
    // Step 1: recompile status slot assignments (deterministic sequential allocation)
    const statusSlots = recompileStatusSlots(model);

    const memoryPorts = model.memory.ports || [];

    // Collect required coverage grouped by portId|unitId|area, derived purely
    // from device reads. Port is resolved from device.target_endpoint.
    const required = {};

    for (const device of (model.devices || [])) {
        const unitId = Number(device.unitId);
        if (!Number.isFinite(unitId) || unitId < 0) continue;

        const targetPort = endpointPort(device.target_endpoint) || 502;
        const matchingPort = _idx.portsByNumber.get(targetPort) || null;
        if (!matchingPort) continue; // port does not exist — skip device

        for (const read of (device.reads || [])) {
            const area = read.source_area || 'holding_registers';
            const start = Number(read.source_address);
            const count = Number(read.source_count);
            if (!Number.isFinite(start) || !Number.isFinite(count) || count < 1) continue;

            const key = `${matchingPort.id}|${unitId}|${area}`;
            if (!required[key]) {
                required[key] = { portId: matchingPort.id, unitId, area, ranges: [] };
            }
            required[key].ranges.push({ start, end: start + count - 1 });
        }
    }

    // Track prior block counts to detect changes
    const oldBlockCounts = {};
    for (const port of memoryPorts) {
        oldBlockCounts[port.id] = (port.blocks || []).length;
    }

    // Step 2: clear all existing blocks — full replace, never merge
    for (const port of memoryPorts) {
        port.blocks = [];
    }

    // Step 3: assign freshly-computed blocks derived from reads
    let blocksCreated = 0;
    for (const req of Object.values(required)) {
        const port = _idx.portsById.get(req.portId) || null;
        if (!port) continue;

        // Unified allocation: one contiguous block spanning min start → max end,
        // regardless of gaps between individual read ranges.
        if (req.ranges.length === 0) continue;
        const minStart = Math.min(...req.ranges.map(r => r.start));
        const maxEnd   = Math.max(...req.ranges.map(r => r.end));
        port.blocks.push({
            id: randomUUID(),
            unit_id: req.unitId,
            area: req.area,
            address: minStart,
            count: maxEnd - minStart + 1,
        });
        blocksCreated++;
    }

    // Detect whether any blocks changed
    let blocksChanged = false;
    for (const port of memoryPorts) {
        if ((port.blocks || []).length !== oldBlockCounts[port.id]) {
            blocksChanged = true;
            break;
        }
    }
    // Also mark modified when old non-empty blocks were present (they got new IDs)
    if (!blocksChanged) {
        for (const port of memoryPorts) {
            if (oldBlockCounts[port.id] > 0) { blocksChanged = true; break; }
        }
    }

    const modified = blocksChanged || statusSlots.modified;
    return { modified, blocksCreated };
}

/**
 * Resolve duplicate (port, unit_id) identity conflicts that would arise in the
 * generated MMA listener config.
 *
 * The MMA runtime requires each (listener-port, unit_id) pair to be unique within
 * a listener.  A conflict occurs when a device's status_unit_id equals the unit_id
 * of a regular memory block on the same port.
 *
 * Resolution strategy (deterministic):
 *   - Regular memory blocks (derived from device.unitId) are treated as primary and
 *     are never moved — changing unitId would break Replicator routing.
 *   - status_unit_id values are the remappable dimension.  When a conflict is found,
 *     the status_unit_id is incremented until a free slot is found on that port.
 *   - All devices that share the same (port, old_status_unit_id) are remapped together
 *     so that intentional status-memory sharing is preserved.
 *
 * Fails only if no available unit slot can be found within the valid Modbus range
 * (0–65535).
 *
 * @param {object} model  — mutated in-place when conflicts are resolved
 * @returns {{ resolutionLog: Array<{originalIdentity, newIdentity, reason}>, error?: string }}
 */
function resolveIdentityConflicts(model) {
    const resolutionLog = [];
    const memoryPorts = (model.memory && model.memory.ports) || [];

    // Build per-port set of unit_ids occupied by regular memory blocks.
    const occupiedByPort = new Map(); // portNum → Set<unit_id>
    for (const port of memoryPorts) {
        const portNum = Number(port.port);
        const occupied = new Set();
        for (const block of (port.blocks || [])) {
            occupied.add(Number(block.unit_id));
        }
        // Also include unit_ids from manually-configured units[]
        for (const unit of (port.units || [])) {
            occupied.add(Number(unit.unit_id));
        }
        occupiedByPort.set(portNum, occupied);
    }

    // Track which status_unit_ids have already been processed per port so that
    // multiple devices intentionally sharing the same status_unit_id on the same
    // port are remapped as a group (not individually).
    const statusProcessedByPort = new Map(); // portNum → Map<old_suid, new_suid | null>

    for (const device of (model.devices || [])) {
        if (device.status_unit_id == null) continue;
        const targetPort = endpointPort(device.target_endpoint);
        if (targetPort == null) continue;

        const occupied = occupiedByPort.get(targetPort);
        if (!occupied) continue; // port not in memory model — skip

        const suid = Number(device.status_unit_id);

        if (!statusProcessedByPort.has(targetPort)) {
            statusProcessedByPort.set(targetPort, new Map());
        }
        const processed = statusProcessedByPort.get(targetPort);

        if (processed.has(suid)) {
            // Already handled as part of a group — apply the cached remapping.
            const newUid = processed.get(suid);
            if (newUid !== null) {
                device.status_unit_id = newUid;
            }
            continue;
        }

        if (!occupied.has(suid)) {
            // No conflict — mark as occupied so later status_unit_ids avoid it.
            occupied.add(suid);
            processed.set(suid, null); // null = no remapping needed
            continue;
        }

        // Conflict detected.  Find the next available slot (incremental expansion).
        const MAX_UNIT_ID = 65535;
        let newUid = suid + 1;
        while (newUid <= MAX_UNIT_ID && occupied.has(newUid)) newUid++;
        if (newUid > MAX_UNIT_ID) {
            return {
                resolutionLog,
                error: `Cannot resolve identity conflict for status_unit_id ${suid} on port ${targetPort}: no available unit slot in range 0–${MAX_UNIT_ID}`,
            };
        }

        resolutionLog.push({
            originalIdentity: { port: targetPort, unit: suid },
            newIdentity: { port: targetPort, unit: newUid },
            reason: `status_unit_id ${suid} on port ${targetPort} conflicts with a regular memory block unit_id; remapped to ${newUid}`,
        });

        // Cache the remapping so sibling devices sharing this status_unit_id are
        // updated consistently in subsequent loop iterations.
        processed.set(suid, newUid);
        occupied.add(newUid);

        device.status_unit_id = newUid;
    }

    return { resolutionLog };
}

/**
 * Auto-fix duplicate unit_id conflicts across devices on the same listener port.
 *
 * NOTE: Under MMA2 semantics, unit_id is a CONTAINER ID — multiple blocks sharing
 * the same unit_id on the same port are merged by compileMma2Config at compile time.
 * This function is therefore retained only for the /compile/resolve auto_fix flow and
 * will be a no-op in the common case where duplicates should be merged rather than
 * reassigned.  It reassigns device.unitId when there is a pre-existing model-level
 * conflict that the user explicitly wants resolved by splitting.
 *
 * Mutates model.devices in-place.  Returns { fixed, resolutionLog, error }.
 *
 * @param {object} model
 * @returns {{ fixed: boolean, resolutionLog: Array<object>, error: string|null }}
 */
function autoFixDuplicateUnitIds(model) {
    const MAX_UNIT_ID = 255;
    const resolutionLog = [];

    // Build: portNum → Map<unitId, devices[]>
    const portDevices = new Map();
    for (const device of (model.devices || [])) {
        const uid = Number(device.unitId);
        if (!Number.isFinite(uid) || uid < 0) continue;
        const port = endpointPort(device.target_endpoint);
        if (!port) continue;
        if (!portDevices.has(port)) portDevices.set(port, new Map());
        const uidMap = portDevices.get(port);
        if (!uidMap.has(uid)) uidMap.set(uid, []);
        uidMap.get(uid).push(device);
    }

    for (const [portNum, uidMap] of portDevices) {
        // Build the full set of occupied unitIds on this port to avoid collisions.
        const occupied = new Set([...uidMap.keys()]);

        for (const [uid, devices] of [...uidMap.entries()]) {
            if (devices.length <= 1) continue;

            // Keep the first device; reassign all duplicates to the next free slot.
            const [, ...dupes] = devices;
            for (const dev of dupes) {
                let newUid = uid + 1;
                while (newUid <= MAX_UNIT_ID && occupied.has(newUid)) newUid++;
                if (newUid > MAX_UNIT_ID) {
                    return {
                        fixed: false,
                        resolutionLog,
                        error: `Cannot auto-fix: no free unit_id slot on port ${portNum} (all slots 0–${MAX_UNIT_ID} occupied)`,
                    };
                }
                resolutionLog.push({
                    reason: `Device "${dev.name || dev.id}" (port ${portNum}): duplicate unit_id ${uid} reassigned to ${newUid}`,
                    deviceId: dev.id,
                    portNum,
                    oldUnitId: uid,
                    newUnitId: newUid,
                });
                occupied.add(newUid);
                uidMap.set(newUid, [dev]);
                dev.unitId = newUid;
            }
        }
    }

    return { fixed: resolutionLog.length > 0, resolutionLog, error: null };
}

/**
 * Build a human-readable error summary from MMA and Replicator error arrays.
 * @param {string[]} mmaErrors
 * @param {string[]} replicatorErrors
 * @returns {string}
 */
function buildErrorSummary(mmaErrors, replicatorErrors) {
    const mma = mmaErrors || [];
    const rep = replicatorErrors || [];
    const parts = [];
    if (mma.length > 0) parts.push(`MMA: ${mma[0]}`);
    if (rep.length > 0) parts.push(`Replicator: ${rep[0]}`);
    // extra = total errors minus the one from each array already shown in parts
    const extra = (mma.length + rep.length) - parts.length;
    if (extra > 0) parts.push(`…and ${extra} more issue(s)`);
    return parts.join(' | ') || 'Config validation failed';
}

/**
 * Compile model → YAML and write to disk.
 * Returns { ok, mmaErrors, replicatorErrors, blocksCreated, resolutionLog }.
 * Does NOT throw — callers that want to surface errors should check the return value.
 *
 * @param {object} model
 * @param {Set<number>} [excludedPortNums] - port numbers whose devices should be omitted from replicator YAML
 * @param {{ skipValidation?: boolean }} [opts]
 *   skipValidation — when true, bypass YAML structural validation checks
 *                    (used for "ignore & force continue" user override).  Unsafe: the
 *                    runtime may behave unpredictably with an invalid config.
 */
function compileAndWrite(model, excludedPortNums = new Set(), opts = {}) {
    const { skipValidation = false } = opts;
    // Full rehydration: rebuild all memory state (blocks + status slots) from scratch.
    // This is the single deterministic step that replaces any prior incremental logic.
    const rehydrated = rehydrateFromYaml(model);

    // Resolve identity conflicts BEFORE generating YAML — auto-remap any
    // status_unit_id values that clash with regular memory block unit_ids on the
    // same port.  This is a compile-time resolver, not a validator: conflicts are
    // fixed automatically rather than causing a hard failure.
    const { resolutionLog, error: conflictError } = resolveIdentityConflicts(model);
    if (conflictError) {
        return { ok: false, mmaErrors: [conflictError], replicatorErrors: [], resolutionLog: [] };
    }

    if (rehydrated.modified || resolutionLog.length > 0) {
        // Write model when either rehydration produced new block state OR when conflict
        // resolution remapped one or more status_unit_id values — both mutations must
        // be persisted so subsequent compiles start from the resolved state.
        writeModel(model);
    }

    if (!skipValidation) {
        // Validate no duplicate unit_id within the same port (listener).
        // NOTE: per MMA2 semantics, duplicate unit_id entries are MERGED by
        // compileMma2Config (unit_id is a container ID, not a unique block ID).
        // This check has been intentionally removed — duplicates produce a merged
        // unit in the output, not an error.
    }

    // Validate that no included port has an empty memory block list AND no status devices.
    // A port with no regular blocks is still valid if devices with status_unit_id target it
    // (status blocks are generated dynamically in toMmaYaml).
    // A port with manually-configured units[] is also valid even without auto-derived blocks.
    // This check is never skipped — an empty port is always a structural problem.
    const emptyPorts = (model.memory.ports || [])
        .filter(p => {
            const portNum = Number(p.port);
            if (excludedPortNums.has(portNum)) return false;
            if ((p.units || []).length > 0) return false; // has manually configured units
            if ((p.blocks || []).length > 0) return false;
            // Port is non-empty if any non-excluded device uses it for status memory
            const hasStatusContent = (model.devices || []).some(d =>
                d.status_unit_id != null &&
                endpointPort(d.target_endpoint) === portNum &&
                !excludedPortNums.has(portNum)
            );
            return !hasStatusContent;
        })
        .map(p => Number(p.port));
    if (emptyPorts.length > 0) {
        return {
            ok: false,
            mmaErrors: [`MMA port(s) ${emptyPorts.join(', ')} have no memory blocks — add a read on a device targeting this port before compiling`],
            replicatorErrors: [],
            resolutionLog,
        };
    }

    const replicatorYaml = toReplicatorYaml(model, excludedPortNums);
    const { yaml: mmaYaml, mergeLog } = toMmaYaml(model);

    if (!skipValidation) {
        const mmaErrors = validateMmaConfig(mmaYaml);
        const replicatorErrors = validateReplicatorConfig(replicatorYaml);
        if (mmaErrors.length > 0 || replicatorErrors.length > 0) {
            return { ok: false, mmaErrors, replicatorErrors, resolutionLog, mergeLog };
        }
    }

    atomicWrite(REPLICATOR_CONFIG_PATH, replicatorYaml);
    atomicWrite(MMA_CONFIG_PATH, mmaYaml);
    // Advance the canonical version stamp — every successful YAML write moves
    // the authoritative state forward by exactly one step.
    _canonicalVersion++;
    return { ok: true, blocksCreated: rehydrated.blocksCreated, resolutionLog, mergeLog };
}

/**
 * Silently auto-compile after a model mutation.
 * Devices whose target port does not exist in memory are excluded from YAML output —
 * no ports are auto-created; the user must confirm via the explicit Compile flow.
 * Any errors are swallowed — the model is always saved regardless.
 */
function autoCompile(model) {
    try {
        const missingPorts = getMissingTargetPorts(model);
        const excludedPortNums = new Set(missingPorts);
        compileAndWrite(model, excludedPortNums);
    } catch (_) { /* best-effort */ }
}

// GET /compile/precheck — return port numbers referenced by devices that don't exist in memory yet.
// The frontend uses this to present confirmation dialogs before triggering the full compile.
app.get('/compile/precheck', (req, res) => {
    try {
        const model = readModel();
        const missingPorts = getMissingTargetPorts(model);
        res.json({ missingPorts });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/compile', (req, res) => {
    try {
        const model = readModel();

        // APPLY gate: enforce CHECK → APPLY order.
        // APPLY is only permitted when the CHECK layer reports no errors.
        // Warnings (e.g. devices without reads) do not block compilation.
        const integrity = computeIntegrity(model);
        if (!integrity.ok) {
            const errorMessages = integrity.issues
                .filter(i => i.severity === 'error')
                .map(i => `[${i.deviceName}] ${i.message}`);
            return res.status(422).json({
                status: 'integrity_failed',
                error: 'APPLY blocked — integrity CHECK failed. Run Fix Issues to resolve errors before applying.',
                integrity_errors: errorMessages,
                integrity: integrity,
            });
        }

        // Parse optional list of port numbers the user chose NOT to create (excluded from this compile).
        const excludedPortsList = Array.isArray(req.body && req.body.excluded_ports)
            ? req.body.excluded_ports
            : [];
        const excludedPortNums = new Set(excludedPortsList.map(Number).filter(Number.isFinite));

        // Block if any target ports are still unresolved (missing and not explicitly excluded).
        const missingPorts = getMissingTargetPorts(model).filter(p => !excludedPortNums.has(p));
        if (missingPorts.length > 0) {
            return res.status(422).json({
                error: `Compilation blocked — MMA port(s) ${missingPorts.join(', ')} do not exist and require confirmation`,
                missing_ports: missingPorts,
            });
        }

        // Count routes for non-excluded devices only.
        let routeCount = 0;
        for (const device of (model.devices || [])) {
            const targetPort = endpointPort(device.target_endpoint);
            if (targetPort !== null && excludedPortNums.has(targetPort)) continue;
            routeCount += (device.reads || []).length;
        }

        const result = compileAndWrite(model, excludedPortNums);
        if (!result.ok) {
            return res.status(409).json({
                status: 'error',
                errorSummary: buildErrorSummary(result.mmaErrors, result.replicatorErrors),
                options: ['auto_fix', 'ignore', 'cancel'],
                suggestedOption: 'auto_fix',
                details: {
                    mma_errors: result.mmaErrors,
                    replicator_errors: result.replicatorErrors,
                    resolution_log: result.resolutionLog || [],
                    excluded_ports: [...excludedPortNums],
                },
            });
        }

        res.json({
            ok: true,
            routes: routeCount,
            blocksCreated: result.blocksCreated || 0,
            excluded_ports: [...excludedPortNums],
            resolution_log: result.resolutionLog || [],
            merge_log: result.mergeLog || [],
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /compile/resolve — handle user recovery choice after a compile validation error.
// action: "auto_fix" | "ignore" | "cancel"
// restart: boolean — when true, also restart MMA + Replicator services after compile
// excluded_ports: number[] — ports excluded from this compile pass
app.post('/compile/resolve', async (req, res) => {
    try {
        const body = req.body || {};
        const action = body.action;
        if (!['auto_fix', 'ignore', 'cancel'].includes(action)) {
            return res.status(400).json({ error: 'action must be one of: auto_fix, ignore, cancel' });
        }

        if (action === 'cancel') {
            return res.json({ status: 'resolved', mode: 'cancel' });
        }

        const excludedPortsList = Array.isArray(body.excluded_ports) ? body.excluded_ports : [];
        const excludedPortNums = new Set(excludedPortsList.map(Number).filter(Number.isFinite));
        const shouldRestart = body.restart === true;

        const model = readModel();
        const resolutionLog = [];

        if (action === 'auto_fix') {
            const fixResult = autoFixDuplicateUnitIds(model);
            if (fixResult.error) {
                return res.status(422).json({
                    status: 'error',
                    errorSummary: fixResult.error,
                    options: ['ignore', 'cancel'],
                    suggestedOption: 'cancel',
                    details: { mma_errors: [fixResult.error], replicator_errors: [], resolution_log: fixResult.resolutionLog },
                });
            }
            if (fixResult.fixed) {
                writeModel(model);
            }
            resolutionLog.push(...fixResult.resolutionLog);
        }

        // For "ignore", compile with skipValidation=true (unsafe override).
        const skipValidation = action === 'ignore';
        if (skipValidation) {
            console.warn('[UNSAFE OVERRIDE] User chose to ignore config validation errors and force compile');
        }

        const result = compileAndWrite(model, excludedPortNums, { skipValidation });

        // After an auto_fix attempt the compile may still fail.  Surface remaining errors.
        if (!result.ok) {
            return res.status(409).json({
                status: 'error',
                errorSummary: buildErrorSummary(result.mmaErrors, result.replicatorErrors),
                options: ['ignore', 'cancel'],
                suggestedOption: 'cancel',
                details: {
                    mma_errors: result.mmaErrors,
                    replicator_errors: result.replicatorErrors,
                    resolution_log: [...resolutionLog, ...(result.resolutionLog || [])],
                    merge_log: result.mergeLog || [],
                    excluded_ports: [...excludedPortNums],
                },
            });
        }

        const routes = countRoutes(model, excludedPortNums);
        const allResolutionLog = [...resolutionLog, ...(result.resolutionLog || [])];
        const mergeLog = result.mergeLog || [];

        if (shouldRestart) {
            const restartErrors = [];
            for (const service of ['mma', 'replicator']) {
                try {
                    const stopTimeout = service === 'mma' ? `?t=${MMA_SAFE_STOP_TIMEOUT_SECS}` : '';
                    const r = await dockerApi('POST', `/containers/${service}/restart${stopTimeout}`);
                    if (r.status !== 204 && r.status !== 304) {
                        const msg = (r.body && r.body.message) ? r.body.message : `HTTP ${r.status}`;
                        restartErrors.push(`${service}: ${msg}`);
                    }
                } catch (dockerErr) {
                    restartErrors.push(`${service}: ${dockerErr.message}`);
                }
            }
            if (restartErrors.length > 0) {
                return res.status(207).json({
                    status: 'resolved',
                    mode: action,
                    routes,
                    blocksCreated: result.blocksCreated || 0,
                    resolutionLog: allResolutionLog,
                    merge_log: mergeLog,
                    restart_errors: restartErrors,
                });
            }
        }

        res.json({
            status: 'resolved',
            mode: action,
            routes,
            blocksCreated: result.blocksCreated || 0,
            resolutionLog: allResolutionLog,
            merge_log: mergeLog,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Simple in-memory rate limiter for read-heavy endpoints (max 30 req/min per IP).
const _rateLimitStore = new Map();
function rateLimit(req, res, next) {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const window = 60_000;
    const maxReqs = 30;
    const entry = _rateLimitStore.get(key) || { count: 0, start: now };
    if (now - entry.start > window) {
        entry.count = 0;
        entry.start = now;
    }
    entry.count += 1;
    _rateLimitStore.set(key, entry);
    if (entry.count > maxReqs) {
        return res.status(429).json({ error: 'Too many requests — please wait before retrying' });
    }
    next();
}

// GET /validate — validate the current on-disk config files against separation rules
app.get('/validate', rateLimit, (req, res) => {
    try {
        const result = {
            mma: { valid: true, errors: [] },
            replicator: { valid: true, errors: [] },
        };

        if (fs.existsSync(MMA_CONFIG_PATH)) {
            const yaml = fs.readFileSync(MMA_CONFIG_PATH, 'utf-8');
            const errors = validateMmaConfig(yaml);
            result.mma.valid = errors.length === 0;
            result.mma.errors = errors;
        } else {
            result.mma.valid = false;
            result.mma.errors = ['Config file not found — run Compile to generate it'];
        }

        if (fs.existsSync(REPLICATOR_CONFIG_PATH)) {
            const yaml = fs.readFileSync(REPLICATOR_CONFIG_PATH, 'utf-8');
            const errors = validateReplicatorConfig(yaml);
            result.replicator.valid = errors.length === 0;
            result.replicator.errors = errors;
        } else {
            result.replicator.valid = false;
            result.replicator.errors = ['Config file not found — run Compile to generate it'];
        }

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// computeIntegrity(model) — pure CHECK layer (read-only, no side effects).
//
// Detects configuration and system inconsistencies across all devices:
//   - UNALLOCATED_SLOT  : device has no assigned status_slot
//   - DUPLICATE_SLOT    : status_slot collision within the same target_endpoint group
//   - UNASSIGNED_STATUS_UNIT_ID : status_unit_id not yet assigned
//   - INCONSISTENT_STATUS_UNIT_ID : different status_unit_ids within same endpoint group
//   - Missing required source/target fields
//   - Devices without reads (warning — device excluded from YAML)
//
// Returns { ok, issues, devices, status_slot_size } — identical shape to
// the GET /yaml-integrity HTTP response.  Safe to call from any route that
// needs to gate behaviour on integrity state without issuing an HTTP request.
// ---------------------------------------------------------------------------
function computeIntegrity(model) {
    const devices = model.devices || [];

    // Build per-endpoint slot map: endpointKey → Map<slot, deviceId[]>
    // Used to detect duplicate status_slots within the same target_endpoint group.
    const epSlotMap = new Map();
    for (const device of devices) {
        const slot = device.status_slot;
        if (slot == null) continue;
        const epKey = (device.target_endpoint || '').trim().toLowerCase() || '__null__';
        if (!epSlotMap.has(epKey)) epSlotMap.set(epKey, new Map());
        const slotMap = epSlotMap.get(epKey);
        const slotNum = Number(slot);
        if (!slotMap.has(slotNum)) slotMap.set(slotNum, []);
        slotMap.get(slotNum).push(device.id);
    }

    // Build per-endpoint status_unit_id maps for consistency checks.
    // All devices sharing the same target_endpoint must have the same status_unit_id.
    // Canonical = highest count wins; lowest value breaks ties — same rule as the fix endpoint.
    const epStatusUidMap = new Map();
    const epCanonicalUid = new Map();
    for (const device of devices) {
        if (device.status_unit_id == null) continue;
        const epKey = (device.target_endpoint || '').trim().toLowerCase() || '__null__';
        if (!epStatusUidMap.has(epKey)) epStatusUidMap.set(epKey, new Map());
        const counts = epStatusUidMap.get(epKey);
        const suid = Number(device.status_unit_id);
        counts.set(suid, (counts.get(suid) || 0) + 1);
    }
    for (const [epKey, counts] of epStatusUidMap) {
        let canonical = null;
        let bestCount = -1;
        for (const [suid, count] of counts) {
            if (count > bestCount || (count === bestCount && suid < canonical)) {
                canonical = suid;
                bestCount = count;
            }
        }
        epCanonicalUid.set(epKey, canonical);
    }

    const issues = [];
    const deviceResults = [];

    for (const device of devices) {
        const deviceIssues = [];

        // CHECK: status_slot is assigned and unique within the same target_endpoint group.
        if (device.status_slot == null) {
            deviceIssues.push({ code: 'UNALLOCATED_SLOT', severity: 'error', message: 'UNALLOCATED_SLOT — device has no assigned slot; run Fix Issues to repair' });
        } else {
            const epKey = (device.target_endpoint || '').trim().toLowerCase() || '__null__';
            const slotMap = epSlotMap.get(epKey) || new Map();
            const slot = Number(device.status_slot);
            const sharing = slotMap.get(slot) || [];
            if (sharing.length > 1) {
                const others = sharing.filter(id => id !== device.id).join(', ');
                deviceIssues.push({ code: 'DUPLICATE_SLOT', severity: 'error', message: `DUPLICATE_SLOT — status_slot ${slot} is duplicated within endpoint "${device.target_endpoint}" — also used by: ${others}` });
            }
        }

        // CHECK: status_unit_id is assigned and matches all devices on the same target_endpoint.
        if (device.status_unit_id == null) {
            deviceIssues.push({ code: 'UNASSIGNED_STATUS_UNIT_ID', severity: 'error', message: 'UNASSIGNED_STATUS_UNIT_ID — status_unit_id not assigned; run Memory Consistency check to fix' });
        } else {
            const epKey = (device.target_endpoint || '').trim().toLowerCase() || '__null__';
            const counts = epStatusUidMap.get(epKey) || new Map();
            if (counts.size > 1) {
                const canonical = epCanonicalUid.get(epKey);
                const actual = Number(device.status_unit_id);
                if (actual !== canonical) {
                    const allUids = [...counts.keys()].join(', ');
                    deviceIssues.push({ code: 'INCONSISTENT_STATUS_UNIT_ID', severity: 'error', message: `INCONSISTENT_STATUS_UNIT_ID — status_unit_id ${actual} differs from other devices on endpoint "${device.target_endpoint}" — found [${allUids}], expected all to match` });
                }
            }
        }

        // CHECK: required source fields.
        if (!device.source_endpoint) {
            deviceIssues.push({ code: 'MISSING_SOURCE_ENDPOINT', severity: 'error', message: 'source_endpoint is missing' });
        }
        if (device.source_unit_id == null) {
            deviceIssues.push({ code: 'MISSING_SOURCE_UNIT_ID', severity: 'error', message: 'source_unit_id is missing' });
        }

        // CHECK: required target fields.
        if (!device.target_endpoint) {
            deviceIssues.push({ code: 'MISSING_TARGET_ENDPOINT', severity: 'error', message: 'target_endpoint is missing' });
        }
        if (device.unitId == null) {
            deviceIssues.push({ code: 'MISSING_TARGET_UNIT_ID', severity: 'error', message: 'target unit_id (unitId) is missing' });
        }

        // CHECK: device would be included in compiled YAML (needs at least one read).
        const reads = device.reads || [];
        const includedInYaml = reads.length > 0;
        if (!includedInYaml) {
            deviceIssues.push({ code: 'NO_READS', severity: 'warning', message: 'no reads configured — device excluded from replicator YAML' });
        }

        const result = {
            id: device.id,
            name: device.name || device.id,
            status_slot: device.status_slot != null ? Number(device.status_slot) : null,
            status_unit_id: device.status_unit_id != null ? Number(device.status_unit_id) : null,
            target_port: endpointPort(device.target_endpoint),
            includedInYaml,
            issues: deviceIssues,
        };
        deviceResults.push(result);

        for (const issue of deviceIssues) {
            issues.push({ deviceId: device.id, deviceName: device.name || device.id, ...issue });
        }
    }

    return {
        ok: issues.filter(i => i.severity === 'error').length === 0,
        issues,
        devices: deviceResults,
        status_slot_size: STATUS_SLOT_SIZE,
    };
}

// GET /yaml-integrity — CHECK layer: detect configuration and system inconsistencies.
// Read-only — never mutates model or state.
// Returns { ok, issues, devices, status_slot_size }.
app.get('/yaml-integrity', (req, res) => {
    try {
        const model = readModel();
        res.json(computeIntegrity(model));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /yaml-integrity/fix — auto-fix status_slot and status_unit_id inconsistencies.
// Fixes:
//   1. Missing or duplicate status_slots — recompileStatusSlots() clears duplicates and fills
//      gaps per endpoint group so every device gets a unique slot.
//   2. Devices sharing the same target_endpoint with differing or null status_unit_id —
//      propagates / normalises to the value used by the majority (or the lowest when tied)
//      so all devices on the same endpoint share one status_unit_id.
// Returns { fixed, changes: string[] }
app.post('/yaml-integrity/fix', (req, res) => {
    try {
        const model = readModel();
        const devices = model.devices || [];
        const changes = [];

        // ── 1. Fix status_slot ────────────────────────────────────────────────
        const { modified: slotsModified } = recompileStatusSlots(model);
        if (slotsModified) {
            changes.push('Re-assigned missing or duplicate status_slot values (per target endpoint)');
        }

        // ── 2. Fix status_unit_id per-endpoint inconsistency ─────────────────
        // Group ALL devices by target_endpoint (including those with null status_unit_id).
        const epGroups = new Map(); // endpointKey → { endpoint, counts: Map<suid, count>, devices: device[] }
        for (const device of devices) {
            const epKey = (device.target_endpoint || '').trim().toLowerCase() || '__null__';
            if (!epGroups.has(epKey)) epGroups.set(epKey, { endpoint: device.target_endpoint, counts: new Map(), devices: [] });
            const grp = epGroups.get(epKey);
            if (device.status_unit_id != null) {
                const suid = Number(device.status_unit_id);
                grp.counts.set(suid, (grp.counts.get(suid) || 0) + 1);
            }
            grp.devices.push(device);
        }

        for (const { endpoint, counts, devices: grpDevices } of epGroups.values()) {
            if (counts.size === 0) continue; // no devices with status_unit_id in this group

            // Choose the canonical value: highest count wins; lowest value breaks ties.
            let canonical = null;
            let bestCount = -1;
            for (const [suid, count] of counts) {
                if (count > bestCount || (count === bestCount && suid < canonical)) {
                    canonical = suid;
                    bestCount = count;
                }
            }

            if (counts.size === 1) {
                // Consistent among assigned devices — only propagate to null devices.
                let propagated = 0;
                for (const device of grpDevices) {
                    if (device.status_unit_id == null) {
                        device.status_unit_id = canonical;
                        propagated++;
                    }
                }
                if (propagated > 0) {
                    changes.push(`Endpoint "${endpoint}": propagated status_unit_id ${canonical} to ${propagated} unassigned device(s)`);
                }
            } else {
                // Inconsistent — normalise all devices (including null ones) to canonical.
                let reassigned = 0;
                for (const device of grpDevices) {
                    if (device.status_unit_id == null || Number(device.status_unit_id) !== canonical) {
                        device.status_unit_id = canonical;
                        reassigned++;
                    }
                }
                if (reassigned > 0) {
                    changes.push(`Endpoint "${endpoint}": normalised ${reassigned} device(s) to status_unit_id ${canonical}`);
                }
            }
        }

        const fixed = changes.length > 0;
        if (fixed) {
            writeModel(model);
            scheduleCompile();
        }

        // After FIX, automatically re-run CHECK and include the updated integrity state
        // in the response so callers can determine if all issues have been resolved.
        const postFixIntegrity = computeIntegrity(readModel());
        res.json({ fixed, changes, integrity: postFixIntegrity });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// Device status reading (Modbus TCP → MMA status blocks)
// ---------------------------------------------------------------------------

/**
 * Read holding registers from a Modbus TCP endpoint.
 * Uses the built-in `net` module — no extra dependencies.
 * Returns an array of uint16 register values, or null on any error/timeout.
 *
 * @param {string} host
 * @param {number} port
 * @param {number} unitId   - Modbus unit ID
 * @param {number} startAddr - First register address (0-based)
 * @param {number} count     - Number of registers to read
 * @param {number} [timeoutMs=2000]
 * @returns {Promise<number[]|null>}
 */
function modbusReadHoldingRegisters(host, port, unitId, startAddr, count, timeoutMs) {
    timeoutMs = timeoutMs || 2000;
    return new Promise(resolve => {
        let settled = false;
        const done = val => { if (!settled) { settled = true; resolve(val); } };

        const socket = net.createConnection({ host, port: Number(port) });
        const timer = setTimeout(() => { socket.destroy(); done(null); }, timeoutMs);

        // Modbus TCP request (MBAP header + PDU)
        const req = Buffer.alloc(12);
        req.writeUInt16BE(1, 0);          // Transaction ID
        req.writeUInt16BE(0, 2);          // Protocol ID
        req.writeUInt16BE(6, 4);          // Length (bytes that follow)
        req.writeUInt8(unitId & 0xFF, 6); // Unit ID
        req.writeUInt8(3, 7);             // FC 03: Read Holding Registers
        req.writeUInt16BE(startAddr, 8);
        req.writeUInt16BE(count, 10);

        const chunks = [];
        socket.on('connect', () => socket.write(req));
        socket.on('data', chunk => {
            chunks.push(chunk);
            const data = Buffer.concat(chunks);
            // Wait for at least MBAP header (7 bytes) + FC byte + byte-count byte
            if (data.length < 9) return;
            const byteCount = data[8];
            if (data.length < 9 + byteCount) return;
            clearTimeout(timer);
            socket.destroy();
            // Validate FC and byte count
            if (data[7] !== 3 || byteCount !== count * 2) { done(null); return; }
            const regs = [];
            for (let i = 0; i < count; i++) {
                regs.push(data.readUInt16BE(9 + i * 2));
            }
            done(regs);
        });
        socket.on('error', () => { clearTimeout(timer); socket.destroy(); done(null); });
        socket.on('close', () => { clearTimeout(timer); done(null); });
    });
}

// GET /devices/status — read health_code (Slot 0) and device_name (Slots 3–10)
//   from each device's status block in MMA.
//   Reads are batched per (endpoint, status_unit_id) to minimise TCP connections.
//   Returns { ok: true, status: { [deviceId]: { health_code, device_name } } }
app.get('/devices/status', async (req, res) => {
    try {
        const model = readModel();
        const devices = model.devices || [];
        const result = {};

        // Group devices by (host, port, status_unit_id) so we can batch-read.
        const groupMap = new Map();
        for (const device of devices) {
            if (device.status_unit_id == null) continue;
            const ep = device.target_endpoint || `${TARGET_HOST}:502`;
            const lastColon = ep.lastIndexOf(':');
            const host = lastColon > 0 ? ep.slice(0, lastColon) : ep;
            const port = lastColon > 0 ? parseInt(ep.slice(lastColon + 1), 10) : 502;
            const key = `${host}\x00${port}\x00${device.status_unit_id}`;
            if (!groupMap.has(key)) {
                groupMap.set(key, { host, port, unitId: Number(device.status_unit_id), devices: [] });
            }
            groupMap.get(key).devices.push(device);
        }

        await Promise.all([...groupMap.values()].map(async ({ host, port, unitId, devices: grpDevs }) => {
            const maxSlot = Math.max(...grpDevs.map(d => Number(d.status_slot) || 0));
            // Read from address 0 through end of last device's Slot 10 (device_name end).
            const readCount = maxSlot * STATUS_SLOT_SIZE + 11;
            const regs = await modbusReadHoldingRegisters(host, port, unitId, 0, readCount);

            for (const device of grpDevs) {
                const base = (Number(device.status_slot) || 0) * STATUS_SLOT_SIZE;
                let health_code = 0;
                let device_name = '';
                if (regs && regs.length > base) {
                    health_code = regs[base] !== undefined ? regs[base] : 0;
                    // Slots 3–10: 8 registers = 16 ASCII bytes; only read if registers are present
                    const nameStart = base + 3;
                    const nameEnd = Math.min(base + 11, regs.length);
                    if (nameEnd > nameStart) {
                        const nameRegs = regs.slice(nameStart, nameEnd);
                        const nameBytes = Buffer.alloc(nameRegs.length * 2);
                        for (let i = 0; i < nameRegs.length; i++) {
                            nameBytes.writeUInt16BE(nameRegs[i] || 0, i * 2);
                        }
                        device_name = nameBytes.toString('ascii').replace(/\0.*/, '').trim();
                    }
                }
                result[device.id] = { health_code, device_name };
            }
        }));

        res.json({ ok: true, status: result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// Docker runtime control (via Docker socket)
// ---------------------------------------------------------------------------

const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
const ALLOWED_SERVICES = new Set(['mma', 'replicator']);
// Seconds Docker waits for a graceful SIGTERM before sending SIGKILL on safe stop/restart.
const MMA_SAFE_STOP_TIMEOUT_SECS = 30;

/**
 * Make an HTTP request to the Docker daemon socket.
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} apiPath - Docker API path (e.g. '/containers/mma/json')
 * @returns {Promise<{status: number, body: any}>}
 */
function dockerApi(method, apiPath) {
    return new Promise((resolve, reject) => {
        const opts = {
            socketPath: DOCKER_SOCKET,
            method,
            path: apiPath,
            headers: { 'Content-Type': 'application/json' },
        };
        const req = http.request(opts, (dockerRes) => {
            let data = '';
            dockerRes.on('data', chunk => { data += chunk; });
            dockerRes.on('end', () => {
                let body = null;
                if (data) {
                    try { body = JSON.parse(data); } catch (parseErr) {
                        console.warn(`[dockerApi] Failed to parse Docker response for ${method} ${apiPath}: ${parseErr.message}`);
                        body = data;
                    }
                }
                resolve({ status: dockerRes.statusCode, body });
            });
        });
        req.on('error', reject);
        req.end();
    });
}

// GET /runtime/status — return running state of mma and replicator containers
app.get('/runtime/status', async (req, res) => {
    try {
        const [mmaRes, repRes] = await Promise.all([
            dockerApi('GET', '/containers/mma/json'),
            dockerApi('GET', '/containers/replicator/json'),
        ]);

        const extractStatus = (r) => {
            if (r.status === 404) return 'not_found';
            if (r.status !== 200 || !r.body || !r.body.State) return 'unknown';
            return r.body.State.Status || 'unknown';
        };

        res.json({
            mma: { status: extractStatus(mmaRes) },
            replicator: { status: extractStatus(repRes) },
        });
    } catch (err) {
        res.status(500).json({ error: `Docker socket error: ${err.message}` });
    }
});

// POST /runtime/:service/start|stop|restart — control a service container
// Body (optional): { t: <seconds> } — graceful stop timeout before SIGKILL (stop/restart only).
app.post('/runtime/:service/:action', async (req, res) => {
    try {
        const { service, action } = req.params;
        if (!ALLOWED_SERVICES.has(service)) {
            return res.status(400).json({ error: `Unknown service "${service}"` });
        }
        const allowedActions = new Set(['start', 'stop', 'restart']);
        if (!allowedActions.has(action)) {
            return res.status(400).json({ error: `Unknown action "${action}"` });
        }

        // Optional graceful stop timeout (only meaningful for stop/restart).
        let apiPath = `/containers/${service}/${action}`;
        if (action === 'stop' || action === 'restart') {
            const rawT = req.body && req.body.t;
            const t = Number.isFinite(Number(rawT)) ? Math.min(120, Math.max(1, Math.floor(Number(rawT)))) : null;
            if (t !== null) {
                apiPath += `?t=${t}`;
            }
        }

        const result = await dockerApi('POST', apiPath);
        // Docker returns 204 on success, 304 if already in that state — both are OK
        if (result.status === 204 || result.status === 304) {
            return res.json({ ok: true, service, action });
        }
        const msg = (result.body && result.body.message) ? result.body.message : `HTTP ${result.status}`;
        return res.status(502).json({ error: `Docker error: ${msg}` });
    } catch (err) {
        res.status(500).json({ error: `Docker socket error: ${err.message}` });
    }
});

// GET /runtime/logs/:service — stream Docker container logs via Server-Sent Events
const DOCKER_LOG_TAIL_LINES = 100;

app.get('/runtime/logs/:service', (req, res) => {
    const { service } = req.params;
    if (!ALLOWED_SERVICES.has(service)) {
        return res.status(400).json({ error: `Unknown service "${service}"` });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const apiPath = `/containers/${encodeURIComponent(service)}/logs?follow=1&stdout=1&stderr=1&timestamps=1&tail=${DOCKER_LOG_TAIL_LINES}`;

    const opts = {
        socketPath: DOCKER_SOCKET,
        method: 'GET',
        path: apiPath,
    };

    let dockerReq = null;
    let buffer = Buffer.alloc(0);
    let closed = false;

    const sendEvent = (eventName, data) => {
        if (!closed) {
            try {
                res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
            } catch (_) {
                closed = true;
            }
        }
    };

    const cleanup = () => {
        closed = true;
        if (dockerReq) {
            try { dockerReq.destroy(); } catch (_) {}
            dockerReq = null;
        }
    };

    req.on('close', cleanup);

    try {
        dockerReq = http.request(opts, (dockerRes) => {
            if (dockerRes.statusCode !== 200) {
                sendEvent('log-error', { message: `Docker returned HTTP ${dockerRes.statusCode} for ${service}` });
                res.end();
                return;
            }

            dockerRes.on('data', (chunk) => {
                if (closed) return;
                buffer = Buffer.concat([buffer, chunk]);
                // Parse Docker multiplexed log stream frames.
                // Each frame has an 8-byte header: [stream(1), 0, 0, 0, size_big_endian(4)]
                // stream: 1 = stdout, 2 = stderr
                while (buffer.length >= 8) {
                    const streamType = buffer[0]; // 1=stdout, 2=stderr
                    const frameSize = buffer.readUInt32BE(4);
                    if (buffer.length < 8 + frameSize) break;
                    const payload = buffer.slice(8, 8 + frameSize).toString('utf8');
                    buffer = buffer.slice(8 + frameSize);
                    const lines = payload.split('\n');
                    for (const line of lines) {
                        if (line) {
                            sendEvent('log', { type: streamType, line });
                        }
                    }
                }
            });

            dockerRes.on('end', () => {
                sendEvent('stream-end', {});
                res.end();
            });

            dockerRes.on('error', (err) => {
                sendEvent('log-error', { message: err.message });
                res.end();
            });
        });

        dockerReq.on('error', (err) => {
            if (!res.headersSent) {
                res.status(500).json({ error: err.message });
            } else {
                sendEvent('log-error', { message: err.message });
                res.end();
            }
        });

        dockerReq.end();
    } catch (err) {
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        } else {
            sendEvent('log-error', { message: err.message });
            res.end();
        }
    }
});

/**
 * Count routes (reads) for all devices whose target port is not in excludedPortNums.
 * @param {object} model
 * @param {Set<number>} excludedPortNums
 * @returns {number}
 */
function countRoutes(model, excludedPortNums) {
    let count = 0;
    for (const device of (model.devices || [])) {
        const targetPort = endpointPort(device.target_endpoint);
        if (targetPort !== null && excludedPortNums.has(targetPort)) continue;
        count += (device.reads || []).length;
    }
    return count;
}

// POST /runtime/apply — APPLY layer: compile configs and write to disk (no service restart).
// Blocked if the CHECK layer (computeIntegrity) reports any errors — enforces CHECK → APPLY order.
app.post('/runtime/apply', async (req, res) => {
    try {
        const model = readModel();

        // APPLY gate: only permitted when CHECK passes.
        const integrity = computeIntegrity(model);
        if (!integrity.ok) {
            const errorMessages = integrity.issues
                .filter(i => i.severity === 'error')
                .map(i => `[${i.deviceName}] ${i.message}`);
            return res.status(422).json({
                status: 'integrity_failed',
                error: 'APPLY blocked — integrity CHECK failed. Run Fix Issues to resolve errors before applying.',
                integrity_errors: errorMessages,
                integrity: integrity,
            });
        }

        const excludedPortsList = Array.isArray(req.body && req.body.excluded_ports)
            ? req.body.excluded_ports : [];
        const excludedPortNums = new Set(excludedPortsList.map(Number).filter(Number.isFinite));

        const missingPorts = getMissingTargetPorts(model).filter(p => !excludedPortNums.has(p));
        if (missingPorts.length > 0) {
            return res.status(422).json({
                error: `Compilation blocked — MMA port(s) ${missingPorts.join(', ')} do not exist and require confirmation`,
                missing_ports: missingPorts,
            });
        }

        const result = compileAndWrite(model, excludedPortNums);
        if (!result.ok) {
            return res.status(409).json({
                status: 'error',
                errorSummary: buildErrorSummary(result.mmaErrors, result.replicatorErrors),
                options: ['auto_fix', 'ignore', 'cancel'],
                suggestedOption: 'auto_fix',
                details: {
                    mma_errors: result.mmaErrors,
                    replicator_errors: result.replicatorErrors,
                    resolution_log: result.resolutionLog || [],
                    excluded_ports: [...excludedPortNums],
                },
            });
        }

        res.json({ ok: true, routes: countRoutes(model, excludedPortNums), blocksCreated: result.blocksCreated || 0, excluded_ports: [...excludedPortNums] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /runtime/apply-restart — APPLY layer: compile configs and restart both services.
// Blocked if the CHECK layer (computeIntegrity) reports any errors — enforces CHECK → APPLY order.
app.post('/runtime/apply-restart', async (req, res) => {
    try {
        const model = readModel();

        // APPLY gate: only permitted when CHECK passes.
        const integrity = computeIntegrity(model);
        if (!integrity.ok) {
            const errorMessages = integrity.issues
                .filter(i => i.severity === 'error')
                .map(i => `[${i.deviceName}] ${i.message}`);
            return res.status(422).json({
                status: 'integrity_failed',
                error: 'APPLY blocked — integrity CHECK failed. Run Fix Issues to resolve errors before applying.',
                integrity_errors: errorMessages,
                integrity: integrity,
            });
        }

        const excludedPortsList = Array.isArray(req.body && req.body.excluded_ports)
            ? req.body.excluded_ports : [];
        const excludedPortNums = new Set(excludedPortsList.map(Number).filter(Number.isFinite));

        const missingPorts = getMissingTargetPorts(model).filter(p => !excludedPortNums.has(p));
        if (missingPorts.length > 0) {
            return res.status(422).json({
                error: `Compilation blocked — MMA port(s) ${missingPorts.join(', ')} do not exist and require confirmation`,
                missing_ports: missingPorts,
            });
        }

        const result = compileAndWrite(model, excludedPortNums);
        if (!result.ok) {
            return res.status(409).json({
                status: 'error',
                errorSummary: buildErrorSummary(result.mmaErrors, result.replicatorErrors),
                options: ['auto_fix', 'ignore', 'cancel'],
                suggestedOption: 'auto_fix',
                details: {
                    mma_errors: result.mmaErrors,
                    replicator_errors: result.replicatorErrors,
                    resolution_log: result.resolutionLog || [],
                    excluded_ports: [...excludedPortNums],
                    restart: true,
                },
            });
        }

        const routes = countRoutes(model, excludedPortNums);

        // Restart both services sequentially: MMA first (with safe stop timeout), then Replicator
        const restartErrors = [];
        for (const service of ['mma', 'replicator']) {
            try {
                const stopTimeout = service === 'mma' ? `?t=${MMA_SAFE_STOP_TIMEOUT_SECS}` : '';
                const r = await dockerApi('POST', `/containers/${service}/restart${stopTimeout}`);
                if (r.status !== 204 && r.status !== 304) {
                    const msg = (r.body && r.body.message) ? r.body.message : `HTTP ${r.status}`;
                    restartErrors.push(`${service}: ${msg}`);
                }
            } catch (dockerErr) {
                restartErrors.push(`${service}: ${dockerErr.message}`);
            }
        }

        if (restartErrors.length > 0) {
            return res.status(207).json({
                ok: false,
                routes,
                blocksCreated: result.blocksCreated || 0,
                error: `Configs applied but some restarts failed: ${restartErrors.join('; ')}`,
                restart_errors: restartErrors,
            });
        }

        res.json({ ok: true, routes, blocksCreated: result.blocksCreated || 0, excluded_ports: [...excludedPortNums] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------

/**
 * Discover the running image tag via the Docker socket and update APP_VERSION.
 * Falls back to the current value (env var or 'dev') if discovery fails.
 */
async function discoverVersion() {
    try {
        const id = os.hostname();
        const result = await dockerApi('GET', `/containers/${id}/json`);
        if (result.status === 200 && result.body?.Config?.Image) {
            const image = result.body.Config.Image; // e.g. "rodtamin/mcs-web:v1.2.3"
            const tag = image.includes(':') ? image.split(':').pop() : null;
            if (tag) {
                APP_VERSION = tag;
                console.log(`[version] Discovered version from image tag: ${APP_VERSION}`);
            }
            // Discover digest from image metadata if not already set via env var
            if (!DOCKER_DIGEST) {
                try {
                    const imgResult = await dockerApi('GET', `/images/${encodeURIComponent(image)}/json`);
                    if (imgResult.status === 200 && Array.isArray(imgResult.body?.RepoDigests) && imgResult.body.RepoDigests.length > 0) {
                        // RepoDigests entries are like "repo@sha256:hexhash"
                        const repoDigest = imgResult.body.RepoDigests[0];
                        const atIdx = repoDigest.indexOf('@');
                        const digestPart = atIdx !== -1 ? repoDigest.slice(atIdx + 1) : repoDigest;
                        // 'sha256:' (7) + at least 6 hex chars = 13 minimum meaningful digest
                        if (digestPart.startsWith('sha256:') && digestPart.length > 13) {
                            DOCKER_DIGEST = digestPart;
                            console.log(`[version] Discovered digest: ${DOCKER_DIGEST.slice(0, 19)}…`);
                        }
                    }
                } catch (imgErr) {
                    console.warn(`[version] Could not fetch image digest: ${imgErr.message}`);
                }
            }
        }
    } catch (err) {
        console.warn(`[version] Could not self-discover version via Docker socket: ${err.message}`);
    }
}

discoverVersion().finally(() => {
    app.listen(8080, () => {
        console.log('Web running on 8080');
    });
});