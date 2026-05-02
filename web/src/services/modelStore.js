'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

// ---------------------------------------------------------------------------
// Paths and constants
// ---------------------------------------------------------------------------

const DATA_DIR = process.env.DATA_DIR || '/app/data';
const TARGET_HOST = process.env.TARGET_HOST || 'mma';
const MODEL_PATH = path.join(DATA_DIR, 'model.json');
const REPLICATOR_CONFIG_PATH = path.join(DATA_DIR, 'replicator/config.yaml');
const MMA_CONFIG_PATH = path.join(DATA_DIR, 'mma/config.yaml');

const DEFAULT_SYSTEM = {};

// Number of holding registers consumed by each device's status slot.
const STATUS_SLOT_SIZE = 30;

// Default Modbus unit_id used for the status memory block on each MMA listener.
// Chosen to avoid collision with typical device unit_id values (usually small integers).
const DEFAULT_STATUS_UNIT_ID = 246;

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
// YAML content hash — SHA-256 of the last successfully written replicator.yaml
// + mma.yaml pair.  Computed and stored inside compileAndWrite() whenever both
// files are atomically committed to disk.  Exposed via GET /model/snapshot so
// the UI can detect filesystem drift between saves (e.g. external edits or a
// second client triggering a compile).  Null until the first successful compile.
// ---------------------------------------------------------------------------
let _yamlContentHash = null;

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
// Canonical version / yaml hash accessors (mutated by compileService)
// ---------------------------------------------------------------------------

function getCanonicalVersion() { return _canonicalVersion; }
function bumpCanonicalVersion() { _canonicalVersion++; }
function getYamlHash() { return _yamlContentHash; }
function setYamlHash(hash) { _yamlContentHash = hash; }

// Discard the in-memory model cache so the next readModel() re-reads from disk.
// Called by compileService when a compile pass fails after mutating the model
// in memory (rehydration / conflict resolution).
function invalidateCache() { _modelCache = null; }

// ---------------------------------------------------------------------------
// Model I/O
// ---------------------------------------------------------------------------

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

function writeModel(model) {
    _modelCache = model;
    rebuildIndexes(model);
    atomicWrite(MODEL_PATH, JSON.stringify(model, null, 2));
}

function initialModel() {
    return { system: DEFAULT_SYSTEM, groups: [], devices: [], memory: { ports: [] } };
}

/**
 * Merge all segments in an area into a single contiguous block spanning
 * min(start) → max(start+count).  Used only for the explicit user-triggered
 * "Merge Segments" operation — never called automatically.
 *
 * @param {{ start: number, count: number }[]} segments
 * @returns {{ start: number, count: number }[]}  single-element array
 */
function mergeSegments(segments) {
    if (!segments || segments.length === 0) return [];
    const minStart = Math.min(...segments.map(s => s.start));
    const maxEnd   = Math.max(...segments.map(s => s.start + s.count));
    return [{ start: minStart, count: maxEnd - minStart }];
}

/**
 * Return the widest range that covers both (start1, count1) and (start2, count2).
 * Retained for backward-compatibility with callers that explicitly merge ranges.
 */
function widenRange(start1, count1, start2, count2) {
    const newStart = Math.min(start1, start2);
    const newEnd   = Math.max(start1 + count1 - 1, start2 + count2 - 1);
    return { start: newStart, count: newEnd - newStart + 1 };
}

/**
 * Apply all in-place migration passes to a freshly parsed model object.
 * Writes the model back to disk when any field was changed.
 * Returns the (possibly mutated) model.
 */
function migrateModel(model) {
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
    // Migrate areas that still use legacy scalar start+count → segments: [{start, count}].
    // This preserves existing configurations when upgrading from the old single-block model.
    for (const port of model.memory.ports) {
        for (const unit of (port.units || [])) {
            for (const area of (unit.areas || [])) {
                if (!Array.isArray(area.segments) &&
                        area.start !== undefined && area.count !== undefined) {
                    console.warn('[migrateModel] Deprecated schema: scalar start/count on area migrated to segments array — "segments" wrapper removed');
                    area.segments = [{ start: Number(area.start), count: Number(area.count) }];
                    delete area.start;
                    delete area.count;
                    migrated = true;
                }
            }
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
    return model;
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
    model = migrateModel(model);
    _modelCache = model; // always cache after the first cold read, regardless of migration
    rebuildIndexes(model);
    return model;
}

// ---------------------------------------------------------------------------
// Validation helpers
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

// ---------------------------------------------------------------------------
// Model lookup helpers
// ---------------------------------------------------------------------------

function findGroup(model, groupId) {
    return (model.groups || []).find(g => g.id === groupId) || null;
}

function findDevice(model, deviceId) {
    return _idx.devicesById.get(deviceId) || null;
}

function findMemoryPort(model, portId) {
    return _idx.portsById.get(portId) || null;
}

function findUnit(port, unitId) {
    return ((port && port.units) || []).find(u => u.id === unitId) || null;
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
// applied in-place.
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
    // Each read range becomes its own segment — segments are never auto-merged.
    // Existing areas are left untouched so user-configured segments are preserved.
    const existingAreaTypes = new Set(unit.areas.map(a => a.type));
    for (const [areaType, ranges] of Object.entries(readsByArea)) {
        if (existingAreaTypes.has(areaType)) continue; // already present — preserve user's segments
        const segments = ranges.map(r => ({ start: r.start, count: r.end - r.start + 1 }));
        unit.areas.push({
            id: randomUUID(),
            type: areaType,
            segments,
        });
        console.log(`[ensureTargetMemory] Added area ${areaType} with ${segments.length} segment(s) to unit_id ${unitId}`);
    }
}

// ---------------------------------------------------------------------------
// Status slot management
// ---------------------------------------------------------------------------

/**
 * Choose the canonical status_unit_id from a Map<suid, count>.
 * Highest count wins; lowest suid breaks ties.  Returns fallback when counts is empty.
 *
 * @param {Map<number,number>} counts
 * @param {number|null} fallback
 * @returns {number|null}
 */
function pickCanonicalSuid(counts, fallback) {
    // bestCount starts at -1 so the first entry always sets canonical unconditionally.
    // Tie-breaking (suid < canonical) is only evaluated from the second entry onward,
    // at which point canonical is always a number — no null guard needed.
    let canonical = null;
    let bestCount = -1;
    for (const [suid, count] of counts) {
        if (count > bestCount || (count === bestCount && suid < canonical)) {
            canonical = suid;
            bestCount = count;
        }
    }
    return canonical !== null ? canonical : fallback;
}

/**
 * Return the status_unit_id that all devices on the given target_endpoint should
 * share.  Returns the most-common existing value for the endpoint group, or
 * DEFAULT_STATUS_UNIT_ID when no device in the group has one assigned yet.
 *
 * @param {object} model
 * @param {string} targetEndpoint  — normalised target_endpoint of the device
 * @returns {number}
 */
function getCanonicalStatusUnitId(model, targetEndpoint) {
    const epKey = (targetEndpoint || '').trim().toLowerCase();
    const counts = new Map();
    for (const d of (model.devices || [])) {
        if (d.status_unit_id == null) continue;
        if ((d.target_endpoint || '').trim().toLowerCase() !== epKey) continue;
        const suid = Number(d.status_unit_id);
        counts.set(suid, (counts.get(suid) || 0) + 1);
    }
    return pickCanonicalSuid(counts, DEFAULT_STATUS_UNIT_ID);
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

// ---------------------------------------------------------------------------

module.exports = {
    // Paths
    DATA_DIR,
    TARGET_HOST,
    MODEL_PATH,
    REPLICATOR_CONFIG_PATH,
    MMA_CONFIG_PATH,
    // Constants
    DEFAULT_SYSTEM,
    STATUS_SLOT_SIZE,
    DEFAULT_STATUS_UNIT_ID,
    // Index
    _idx,
    // Version / hash accessors
    getCanonicalVersion,
    bumpCanonicalVersion,
    getYamlHash,
    setYamlHash,
    invalidateCache,
    // Model I/O
    atomicWrite,
    readModel,
    writeModel,
    // Validation helpers
    isRequiredNonNegativeInt,
    isValidIp,
    isValidEndpoint,
    endpointPort,
    getMissingTargetPorts,
    // Model lookup helpers
    findGroup,
    findDevice,
    findMemoryPort,
    findUnit,
    readsOverlap,
    ensureTargetMemory,
    widenRange,
    mergeSegments,
    // Slot management
    pickCanonicalSuid,
    getCanonicalStatusUnitId,
    assignNextSlot,
    recompileStatusSlots,
    // CSV helpers
    csvCell,
    parseCSVRow,
    generateUniqueReadId,
};
