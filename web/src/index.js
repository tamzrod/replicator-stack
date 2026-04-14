const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { randomUUID } = require('crypto');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const DATA_DIR = process.env.DATA_DIR || '/app/data';
const TARGET_HOST = process.env.TARGET_HOST || 'mma';
const MODEL_PATH = path.join(DATA_DIR, 'model.json');
const REPLICATOR_CONFIG_PATH = path.join(DATA_DIR, 'replicator/config.yaml');
const MMA_CONFIG_PATH = path.join(DATA_DIR, 'mma/config.yaml');

const DEFAULT_SYSTEM = {};

// Number of holding registers consumed by each device's status slot.
const STATUS_SLOT_SIZE = 30;

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
    let migrated = false;
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

function writeModel(model) {
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
    return (model.devices || []).find(d => d.id === deviceId) || null;
}



/**
 * Recompile status slot assignments for all devices.
 *
 * Devices sharing the same status_unit_id are sorted deterministically by
 * device.id and assigned sequential slots (0, 1, 2, …).  Any existing
 * status_slot values are overwritten.  Devices without a status_unit_id are
 * left unchanged.
 *
 * @param {object} model
 * @returns {{ modified: boolean }}
 */
function recompileStatusSlots(model) {
    const devices = model.devices || [];

    // Group devices by status_unit_id (skip devices that don't use status memory)
    const groups = {};
    for (const device of devices) {
        if (device.status_unit_id == null) continue;
        const key = String(device.status_unit_id);
        if (!groups[key]) groups[key] = [];
        groups[key].push(device);
    }

    let modified = false;
    for (const groupDevices of Object.values(groups)) {
        // Sort deterministically by device ID so every compile produces the same mapping
        groupDevices.sort((a, b) => String(a.id).localeCompare(String(b.id)));
        for (let i = 0; i < groupDevices.length; i++) {
            if (groupDevices[i].status_slot !== i) {
                groupDevices[i].status_slot = i;
                modified = true;
            }
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
        lines.push(`        device_name: "${device.id}"`);
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

function toMmaYaml(model) {
    // MMA runtime config generated from Memory tab ports and blocks.
    // Format per docs/sample yaml/mma.yaml:
    //   - top-level listeners: array
    //   - each listener has id, listen (":PORT"), and memory
    //   - memory is a list of unit entries with unit_id, holding_registers (start/count), and policy
    const memoryPorts = (model.memory && model.memory.ports) || [];

    if (memoryPorts.length === 0) {
        return 'listeners: []\n';
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

    for (let pi = 0; pi < memoryPorts.length; pi++) {
        const port = memoryPorts[pi];
        const portNum = Number(port.port) || 502;
        // First listener is named "main" (matches sample YAML convention); additional
        // listeners use port-based IDs to stay unique.
        const listenerId = pi === 0 ? 'main' : `port-${portNum}`;
        lines.push(`  - id: ${listenerId}`);
        lines.push(`    listen: ":${portNum}"`);
        lines.push(`    memory:`);
        const blocks = port.blocks || [];
        const statusMap = statusByPort[portNum] || new Map();

        if (blocks.length === 0 && statusMap.size === 0) {
            lines.push(`      []`);
        } else {
            for (const block of blocks) {
                lines.push(`      - unit_id: ${block.unit_id}`);
                // Emit register range based on area type
                if (!block.area || block.area === 'holding_registers') {
                    lines.push(`        holding_registers:`);
                    lines.push(`          start: ${block.address}`);
                    lines.push(`          count: ${block.count}`);
                    lines.push(`        policy:`);
                    lines.push(`          rules:`);
                    lines.push(`            - id: read-only`);
                    lines.push(`              source_ip:`);
                    lines.push(`                - 0.0.0.0/0`);
                    lines.push(`                - ::/0`);
                    lines.push(`              allow_fc: [3]`);
                }
            }
            // Emit dynamically-sized status memory blocks, sorted by unit_id for determinism.
            // Size = device_count × STATUS_SLOT_SIZE (one slot per active device, no gaps).
            for (const [suid, deviceCount] of [...statusMap.entries()].sort((a, b) => a[0] - b[0])) {
                const count = deviceCount * STATUS_SLOT_SIZE;
                lines.push(`      - unit_id: ${suid}`);
                lines.push(`        holding_registers:`);
                lines.push(`          start: 0`);
                lines.push(`          count: ${count}`);
                lines.push(`        policy:`);
                lines.push(`          rules:`);
                lines.push(`            - id: read-write`);
                lines.push(`              source_ip:`);
                lines.push(`                - 0.0.0.0/0`);
                lines.push(`                - ::/0`);
                lines.push(`              allow_fc: [3, 16]`);
            }
        }
    }
    return lines.join('\n') + '\n';
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

// GET /model — return full model
app.get('/model', (req, res) => {
    try {
        res.json(readModel());
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

        model.devices.push({
            id: generatedId,
            name: device.name || '',
            groupId: device.groupId || null,
            source_endpoint: device.source_endpoint.trim(),
            source_unit_id: sourceUnitId,
            target_endpoint: device.target_endpoint.trim(),
            unitId,
            status_slot: device.status_slot != null ? Number(device.status_slot) : 0,
            status_unit_id: device.status_unit_id != null ? Number(device.status_unit_id) : null,
            reads: []
        });
        writeModel(model);
        autoCompile(model);

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
        if (device.status_slot !== undefined) existing.status_slot = Number(device.status_slot);
        if (device.status_unit_id !== undefined) {
            existing.status_unit_id = device.status_unit_id != null ? Number(device.status_unit_id) : null;
        }
        writeModel(model);
        autoCompile(model);
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
        autoCompile(model);
        res.json({ ok: true });
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
        autoCompile(model);
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
            if (sourceConfig.status_slot !== undefined) existing.status_slot = Number(sourceConfig.status_slot);

            existing.target_endpoint = targetConfig.target_endpoint.trim();
            existing.unitId = targetUnitId;
            if (targetConfig.status_unit_id !== undefined) {
                existing.status_unit_id = targetConfig.status_unit_id != null ? Number(targetConfig.status_unit_id) : null;
            }
        }

        // Update system MMA endpoint
        if (mmaEndpointConfig !== undefined) {
            model.system = { ...model.system, mma_endpoint: mmaEndpointConfig || null };
        }

        writeModel(model);
        autoCompile(model);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// Memory port + block CRUD
// ---------------------------------------------------------------------------

function findMemoryPort(model, portId) {
    return ((model.memory && model.memory.ports) || []).find(p => p.id === portId) || null;
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
        const exists = model.memory.ports.some(p => Number(p.port) === portNum);
        if (exists) {
            return res.status(409).json({ error: `Memory port ${portNum} already exists` });
        }
        // Blocks are always derived from device reads via rehydrateFromYaml —
        // the port starts empty and autoCompile will populate blocks from reads.
        const newPort = {
            id: randomUUID(),
            port: portNum,
            blocks: [],
        };
        model.memory.ports.push(newPort);
        writeModel(model);
        autoCompile(model);
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
        const conflict = model.memory.ports.some(p => Number(p.port) === portNum && p.id !== id);
        if (conflict) {
            return res.status(409).json({ error: `Memory port ${portNum} already exists` });
        }
        existing.port = portNum;
        writeModel(model);
        autoCompile(model);
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
        autoCompile(model);
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
        writeModel(model);
        autoCompile(model);

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
        autoCompile(model);
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
        autoCompile(model);
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
        autoCompile(model);
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
        writeModel(model);
        autoCompile(model);
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
        writeModel(model);
        autoCompile(model);
        res.json({ ok: true });
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
        const matchingPort = memoryPorts.find(p => Number(p.port) === targetPort);
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
        const port = memoryPorts.find(p => p.id === req.portId);
        if (!port) continue;

        const merged = mergeRanges(req.ranges);
        for (const m of merged) {
            port.blocks.push({
                id: randomUUID(),
                unit_id: req.unitId,
                area: req.area,
                address: m.start,
                count: m.end - m.start + 1,
            });
            blocksCreated++;
        }
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
 * Compile model → YAML and write to disk.
 * Returns { ok, mmaErrors, replicatorErrors, blocksCreated }.
 * Does NOT throw — callers that want to surface errors should check the return value.
 *
 * @param {object} model
 * @param {Set<number>} [excludedPortNums] - port numbers whose devices should be omitted from replicator YAML
 */
function compileAndWrite(model, excludedPortNums = new Set()) {
    // Full rehydration: rebuild all memory state (blocks + status slots) from scratch.
    // This is the single deterministic step that replaces any prior incremental logic.
    const rehydrated = rehydrateFromYaml(model);
    if (rehydrated.modified) {
        writeModel(model);
    }

    // Validate that no included port has an empty memory block list AND no status devices.
    // A port with no regular blocks is still valid if devices with status_unit_id target it
    // (status blocks are generated dynamically in toMmaYaml).
    const emptyPorts = (model.memory.ports || [])
        .filter(p => {
            const portNum = Number(p.port);
            if (excludedPortNums.has(portNum)) return false;
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
        };
    }

    const replicatorYaml = toReplicatorYaml(model, excludedPortNums);
    const mmaYaml = toMmaYaml(model);
    const mmaErrors = validateMmaConfig(mmaYaml);
    const replicatorErrors = validateReplicatorConfig(replicatorYaml);
    if (mmaErrors.length > 0 || replicatorErrors.length > 0) {
        return { ok: false, mmaErrors, replicatorErrors };
    }
    atomicWrite(REPLICATOR_CONFIG_PATH, replicatorYaml);
    atomicWrite(MMA_CONFIG_PATH, mmaYaml);
    return { ok: true, blocksCreated: rehydrated.blocksCreated };
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
            return res.status(400).json({
                error: 'Config validation failed — generated configs violate separation rules',
                mma_errors: result.mmaErrors,
                replicator_errors: result.replicatorErrors,
            });
        }

        res.json({ ok: true, routes: routeCount, blocksCreated: result.blocksCreated || 0, excluded_ports: [...excludedPortNums] });
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
// Docker runtime control (via Docker socket)
// ---------------------------------------------------------------------------

const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
const ALLOWED_SERVICES = new Set(['mma', 'replicator']);

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
        const result = await dockerApi('POST', `/containers/${service}/${action}`);
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

// POST /runtime/apply — compile configs and write to disk (no service restart)
app.post('/runtime/apply', async (req, res) => {
    try {
        const model = readModel();

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
            return res.status(400).json({
                error: 'Config validation failed — generated configs violate separation rules',
                mma_errors: result.mmaErrors,
                replicator_errors: result.replicatorErrors,
            });
        }

        res.json({ ok: true, routes: countRoutes(model, excludedPortNums), blocksCreated: result.blocksCreated || 0, excluded_ports: [...excludedPortNums] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /runtime/apply-restart — compile configs and restart both services
app.post('/runtime/apply-restart', async (req, res) => {
    try {
        const model = readModel();

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
            return res.status(400).json({
                error: 'Config validation failed — generated configs violate separation rules',
                mma_errors: result.mmaErrors,
                replicator_errors: result.replicatorErrors,
            });
        }

        const routes = countRoutes(model, excludedPortNums);

        // Restart both services sequentially: MMA first, then Replicator
        const restartErrors = [];
        for (const service of ['mma', 'replicator']) {
            try {
                const r = await dockerApi('POST', `/containers/${service}/restart`);
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

app.listen(8080, () => {
    console.log('Web running on 8080');
});