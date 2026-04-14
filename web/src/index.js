const express = require('express');
const fs = require('fs');
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readModel() {
    if (!fs.existsSync(MODEL_PATH)) {
        const initial = { system: DEFAULT_SYSTEM, groups: [], devices: [], memory: { ports: [] } };
        writeModel(initial);
        return initial;
    }
    const model = JSON.parse(fs.readFileSync(MODEL_PATH, 'utf-8'));
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
    if (migrated) writeModel(model);
    return model;
}

function isValidIp(ip) {
    if (typeof ip !== 'string' || !ip.trim()) return false;
    const parts = ip.trim().split('.');
    if (parts.length !== 4) return false;
    return parts.every(p => /^\d+$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
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



// Maps Modbus area names to function codes (per Modbus protocol spec).
const AREA_TO_FC = {
    holding_registers: 3,
    coils: 1,
    input_registers: 4,
    discrete_inputs: 2,
    input_status: 2,
};

function toReplicatorYaml(model) {
    // Replicator orchestration config.
    // Format per docs/sample yaml/replicator.yaml:
    //   - top-level replicator: block
    //   - replicator.units: list, one per device
    //   - each unit: source (endpoint, unit_id, device_name, status_slot),
    //                reads (fc, address, quantity),
    //                targets (id, endpoint, unit_id, memories),
    //                poll (interval_ms)
    const memoryPorts = (model.memory && model.memory.ports) || [];
    const devices = model.devices || [];

    // Build lookup: unit_id (number) → memory port number
    const unitToPort = {};
    for (const port of memoryPorts) {
        for (const block of (port.blocks || [])) {
            const uid = Number(block.unit_id);
            if (Number.isFinite(uid) && !(uid in unitToPort)) {
                unitToPort[uid] = Number(port.port) || 502;
            }
        }
    }
    const defaultPort = (memoryPorts[0] && Number(memoryPorts[0].port)) || 502;

    const lines = ['replicator:', '  units:'];

    for (const device of devices) {
        const deviceReads = device.reads || [];
        if (deviceReads.length === 0) continue;

        const sourceEndpoint = `${device.ipAddress}:${device.port}`;
        const statusSlot = device.status_slot != null ? Number(device.status_slot) : 0;

        // Poll interval: use minimum across all reads for this device.
        const pollMs = Math.min(...deviceReads.map(r => Number(r.poll_interval) || 1000));

        // Determine target endpoint from memory port lookup (by device unitId).
        const targetPortNum = (device.unitId != null && unitToPort[Number(device.unitId)] != null)
            ? unitToPort[Number(device.unitId)]
            : defaultPort;
        const targetEndpoint = `${TARGET_HOST}:${targetPortNum}`;

        lines.push(`    - id: "${device.id}"`);
        lines.push(`      source:`);
        lines.push(`        endpoint: "${sourceEndpoint}"`);
        lines.push(`        unit_id: ${device.source_unit_id}`);
        lines.push(`        device_name: "${device.id}"`);
        lines.push(`        status_slot: ${statusSlot}`);
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
        if (blocks.length === 0) {
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
        if (!device || !device.id) {
            return res.status(400).json({ error: 'device.id is required' });
        }
        if (!isValidIp(device.ipAddress)) {
            return res.status(400).json({ error: 'device.ipAddress must be a valid IPv4 address' });
        }
        const port = Number(device.port);
        if (!Number.isFinite(port) || port < 1 || port > 65535) {
            return res.status(400).json({ error: 'device.port must be a valid port number (1–65535)' });
        }
        const unitId = Number(device.unitId);
        if (!Number.isFinite(unitId) || unitId < 1) {
            return res.status(400).json({ error: 'device.unitId must be a positive integer (MMA unit ID)' });
        }
        const model = readModel();

        if (device.groupId) {
            if (!findGroup(model, device.groupId)) {
                return res.status(400).json({ error: `Group "${device.groupId}" not found` });
            }
        }

        const exists = (model.devices || []).some(d => d.id === device.id);
        if (exists) {
            return res.status(409).json({ error: `Device ${device.id} already exists` });
        }

        model.devices.push({
            id: device.id,
            name: device.name || '',
            groupId: device.groupId || null,
            ipAddress: device.ipAddress.trim(),
            port,
            source_unit_id: device.source_unit_id,
            unitId,
            status_slot: device.status_slot != null ? Number(device.status_slot) : 0,
            status_unit_id: device.status_unit_id != null ? Number(device.status_unit_id) : null,
            reads: []
        });
        writeModel(model);
        autoCompile(model);

        res.status(201).json({ ok: true, unitId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /device/:id — update editable device fields (name, group, ipAddress, port, source_unit_id, unitId)
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
        if (device.port !== undefined) {
            const port = Number(device.port);
            if (!Number.isFinite(port) || port < 1 || port > 65535) {
                return res.status(400).json({ error: 'device.port must be a valid port number (1–65535)' });
            }
            existing.port = port;
        }
        if (device.ipAddress !== undefined) {
            if (!isValidIp(device.ipAddress)) {
                return res.status(400).json({ error: 'device.ipAddress must be a valid IPv4 address' });
            }
            existing.ipAddress = device.ipAddress.trim();
        }
        if (device.unitId !== undefined) {
            const unitId = Number(device.unitId);
            if (!Number.isFinite(unitId) || unitId < 1) {
                return res.status(400).json({ error: 'device.unitId must be a positive integer (MMA unit ID)' });
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
        const newPort = { id: randomUUID(), port: portNum, blocks: [] };
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

// POST /memory/port/:portId/block — add a memory block to a port
app.post('/memory/port/:portId/block', (req, res) => {
    try {
        const { portId } = req.params;
        const { block } = req.body;
        if (!block) {
            return res.status(400).json({ error: 'block is required' });
        }
        const unitId = Number(block.unit_id);
        if (!Number.isFinite(unitId) || unitId < 1) {
            return res.status(400).json({ error: 'block.unit_id must be a positive integer' });
        }
        const address = Number(block.address);
        const count = Number(block.count);
        if (!Number.isFinite(address) || address < 0) {
            return res.status(400).json({ error: 'block.address must be a non-negative integer' });
        }
        if (!Number.isFinite(count) || count < 1) {
            return res.status(400).json({ error: 'block.count must be a positive integer' });
        }
        const model = readModel();
        const port = findMemoryPort(model, portId);
        if (!port) {
            return res.status(404).json({ error: `Memory port ${portId} not found` });
        }
        const newBlock = {
            id: randomUUID(),
            unit_id: unitId,
            area: block.area || 'holding_registers',
            address,
            count,
        };
        port.blocks.push(newBlock);
        writeModel(model);
        autoCompile(model);
        res.status(201).json({ ok: true, id: newBlock.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /memory/port/:portId/block/:blockId — update a memory block
app.put('/memory/port/:portId/block/:blockId', (req, res) => {
    try {
        const { portId, blockId } = req.params;
        const { block } = req.body;
        if (!block) {
            return res.status(400).json({ error: 'block is required' });
        }
        const model = readModel();
        const port = findMemoryPort(model, portId);
        if (!port) {
            return res.status(404).json({ error: `Memory port ${portId} not found` });
        }
        const existing = (port.blocks || []).find(b => b.id === blockId);
        if (!existing) {
            return res.status(404).json({ error: `Memory block ${blockId} not found` });
        }
        if (block.unit_id !== undefined) {
            const unitId = Number(block.unit_id);
            if (!Number.isFinite(unitId) || unitId < 1) {
                return res.status(400).json({ error: 'block.unit_id must be a positive integer' });
            }
            existing.unit_id = unitId;
        }
        if (block.address !== undefined) {
            const address = Number(block.address);
            if (!Number.isFinite(address) || address < 0) {
                return res.status(400).json({ error: 'block.address must be a non-negative integer' });
            }
            existing.address = address;
        }
        if (block.count !== undefined) {
            const count = Number(block.count);
            if (!Number.isFinite(count) || count < 1) {
                return res.status(400).json({ error: 'block.count must be a positive integer' });
            }
            existing.count = count;
        }
        if (block.area !== undefined) existing.area = block.area;
        writeModel(model);
        autoCompile(model);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /memory/port/:portId/block/:blockId — remove a memory block
app.delete('/memory/port/:portId/block/:blockId', (req, res) => {
    try {
        const { portId, blockId } = req.params;
        const model = readModel();
        const port = findMemoryPort(model, portId);
        if (!port) {
            return res.status(404).json({ error: `Memory port ${portId} not found` });
        }
        const idx = (port.blocks || []).findIndex(b => b.id === blockId);
        if (idx === -1) {
            return res.status(404).json({ error: `Memory block ${blockId} not found` });
        }
        port.blocks.splice(idx, 1);
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
 * Check whether every range in `required` is fully covered by some range in `existing`.
 * Both arrays should be pre-merged (sorted, non-overlapping).
 *
 * @param {Array<{start: number, end: number}>} existing - merged existing ranges
 * @param {Array<{start: number, end: number}>} required - merged required ranges
 * @returns {boolean} true if all required ranges are fully covered
 */
function rangesAreCovered(existing, required) {
    for (const req of required) {
        const covered = existing.some(ex => ex.start <= req.start && ex.end >= req.end);
        if (!covered) return false;
    }
    return true;
}

/**
 * Memory validation + auto-creation step.
 *
 * For every Device.read, ensures a corresponding Memory block exists in
 * model.memory.ports that covers the full address range of the read.
 *
 * Matching: port (from device unitId → memory port lookup), unit_id, area,
 *           address range [read.source_address, read.source_address + read.source_count - 1].
 *
 * If blocks overlap or are adjacent after merging with required ranges they are
 * merged into a single expanded block.
 *
 * Returns { modified: boolean, blocksCreated: number }.
 * Mutates model.memory.ports in place.
 */
function ensureMemoryCoverage(model) {
    const memoryPorts = model.memory.ports;
    let modified = false;
    let blocksCreated = 0;

    // Build lookup: unit_id (number) → port id.
    // Consistent with toReplicatorYaml: first port that contains a block for a given
    // unit_id wins; unit_ids are expected to be unique across ports.
    const unitToPortId = {};
    for (const port of memoryPorts) {
        for (const block of (port.blocks || [])) {
            const uid = Number(block.unit_id);
            if (Number.isFinite(uid) && !(uid in unitToPortId)) {
                unitToPortId[uid] = port.id;
            }
        }
    }

    // Collect required coverage grouped by portId|unitId|area
    // Each entry: { portId, unitId, area, ranges: [{start, end}] }
    const required = {};

    for (const device of (model.devices || [])) {
        const unitId = Number(device.unitId);
        if (!Number.isFinite(unitId) || unitId < 1) continue;

        // Resolve which port this unit belongs to; auto-create port 502 if none exists
        let portId = unitToPortId[unitId];
        if (!portId) {
            if (memoryPorts.length === 0) {
                const newPort = { id: randomUUID(), port: 502, blocks: [] };
                memoryPorts.push(newPort);
                modified = true;
            }
            portId = memoryPorts[0].id;
            unitToPortId[unitId] = portId;
        }

        for (const read of (device.reads || [])) {
            const area = read.source_area || 'holding_registers';
            const start = Number(read.source_address);
            const count = Number(read.source_count);
            if (!Number.isFinite(start) || !Number.isFinite(count) || count < 1) continue;
            const end = start + count - 1;

            const key = `${portId}|${unitId}|${area}`;
            if (!required[key]) {
                required[key] = { portId, unitId, area, ranges: [] };
            }
            required[key].ranges.push({ start, end });
        }
    }

    // For each required (portId, unitId, area) group, ensure coverage exists
    for (const req of Object.values(required)) {
        const port = memoryPorts.find(p => p.id === req.portId);
        if (!port) continue;

        const existingBlocks = (port.blocks || []).filter(
            b => Number(b.unit_id) === req.unitId &&
                 (b.area || 'holding_registers') === req.area
        );

        const existingRanges = existingBlocks
            .map(b => ({ start: Number(b.address), end: Number(b.address) + Number(b.count) - 1 }))
            .filter(r => Number.isFinite(r.start) && Number.isFinite(r.end));

        const mergedExisting = mergeRanges(existingRanges);
        const mergedRequired = mergeRanges(req.ranges);

        // If existing blocks already cover all required ranges, nothing to do
        if (rangesAreCovered(mergedExisting, mergedRequired)) continue;

        // Merge required + existing into full coverage set
        const merged = mergeRanges([...existingRanges, ...req.ranges]);

        // Replace existing blocks for this (unitId, area) with merged result
        port.blocks = port.blocks.filter(
            b => !(Number(b.unit_id) === req.unitId &&
                   (b.area || 'holding_registers') === req.area)
        );
        for (const m of merged) {
            port.blocks.push({
                id: randomUUID(),
                unit_id: req.unitId,
                area: req.area,
                address: m.start,
                count: m.end - m.start + 1,
            });
        }
        // Count only net-new blocks (existing blocks that are replaced/merged are not counted).
        blocksCreated += Math.max(0, merged.length - existingBlocks.length);
        modified = true;
    }

    return { modified, blocksCreated };
}

/**
 * Compile model → YAML and write to disk.
 * Returns { ok, mmaErrors, replicatorErrors, blocksCreated }.
 * Does NOT throw — callers that want to surface errors should check the return value.
 */
function compileAndWrite(model) {
    // Step 1: ensure every read has a backing memory block (auto-create if missing)
    const coverage = ensureMemoryCoverage(model);
    if (coverage.modified) {
        writeModel(model);
    }

    const replicatorYaml = toReplicatorYaml(model);
    const mmaYaml = toMmaYaml(model);
    const mmaErrors = validateMmaConfig(mmaYaml);
    const replicatorErrors = validateReplicatorConfig(replicatorYaml);
    if (mmaErrors.length > 0 || replicatorErrors.length > 0) {
        return { ok: false, mmaErrors, replicatorErrors };
    }
    atomicWrite(REPLICATOR_CONFIG_PATH, replicatorYaml);
    atomicWrite(MMA_CONFIG_PATH, mmaYaml);
    return { ok: true, blocksCreated: coverage.blocksCreated };
}

/**
 * Silently auto-compile after a model mutation.
 * Any errors are swallowed — the model is always saved regardless.
 */
function autoCompile(model) {
    try { compileAndWrite(model); } catch (_) { /* best-effort */ }
}

app.post('/compile', (req, res) => {
    try {
        const model = readModel();
        const devices = model.devices || [];

        let routeCount = 0;
        for (const device of devices) {
            routeCount += (device.reads || []).length;
        }

        const result = compileAndWrite(model);
        if (!result.ok) {
            return res.status(400).json({
                error: 'Config validation failed — generated configs violate separation rules',
                mma_errors: result.mmaErrors,
                replicator_errors: result.replicatorErrors,
            });
        }

        res.json({ ok: true, routes: routeCount, blocksCreated: result.blocksCreated || 0 });
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

app.listen(8080, () => {
    console.log('Web running on 8080');
});