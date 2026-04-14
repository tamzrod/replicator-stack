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

const DEFAULT_SYSTEM = {
    targets: []
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readModel() {
    if (!fs.existsSync(MODEL_PATH)) {
        const initial = { system: DEFAULT_SYSTEM, groups: [], devices: [] };
        writeModel(initial);
        return initial;
    }
    const model = JSON.parse(fs.readFileSync(MODEL_PATH, 'utf-8'));
    if (!Array.isArray(model.devices)) model.devices = [];
    if (!Array.isArray(model.groups)) model.groups = [];
    if (!model.system) model.system = {};
    if (!Array.isArray(model.system.targets)) model.system.targets = [];
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
        // Ensure status_slot defaults to 0
        if (!('status_slot' in device)) {
            device.status_slot = 0;
            migrated = true;
        }
    }
    // Remove memory-config fields that no longer belong on targets (keep status_unit_id)
    for (const target of model.system.targets) {
        for (const field of ['status_slot_size']) {
            if (field in target) { delete target[field]; migrated = true; }
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

function toReplicatorYaml(system, devices) {
    // Replicator orchestration config.
    // Format per docs/sample yaml/replicator.yaml:
    //   - top-level replicator: block
    //   - replicator.units: list, one per device
    //   - each unit: source (endpoint, unit_id, device_name, status_slot),
    //                reads (fc, address, quantity),
    //                targets (id, endpoint, unit_id, status_unit_id, memories),
    //                poll (interval_ms)
    const targets = (system && system.targets) || [];

    // Build a lookup map from target name → target object.
    const targetByName = {};
    for (const t of targets) {
        targetByName[t.name] = t;
    }

    const lines = ['replicator:', '  units:'];

    for (const device of devices) {
        const deviceReads = device.reads || [];
        if (deviceReads.length === 0) continue;

        const sourceEndpoint = `${device.ipAddress}:${device.port}`;
        const statusSlot = device.status_slot != null ? Number(device.status_slot) : 0;

        // Poll interval: use minimum across all reads for this device.
        const pollMs = Math.min(...deviceReads.map(r => Number(r.poll_interval) || 1000));

        const target = targetByName[device.target_name] || {};
        const targetEndpointParts = (target.endpoint || `${TARGET_HOST}:502`).split(':');
        const targetHost = targetEndpointParts[0] || TARGET_HOST;
        const targetPort = Number(targetEndpointParts[1]) || 502;
        const targetEndpoint = `${targetHost}:${targetPort}`;
        const statusUnitId = target.status_unit_id != null ? Number(target.status_unit_id) : null;

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
        if (statusUnitId != null) {
            lines.push(`          status_unit_id: ${statusUnitId}`);
        }
        lines.push(`          memories:`);
        lines.push(`            - memory_id: ${device.unitId}`);
        lines.push(`              offsets: {}`);
        lines.push(`      poll:`);
        lines.push(`        interval_ms: ${pollMs}`);
    }
    return lines.join('\n') + '\n';
}

function toMmaYaml(system, devices) {
    // MMA runtime config.
    // Format per docs/sample yaml/mma.yaml:
    //   - top-level listeners: array
    //   - each listener has id, listen (":PORT"), and memory
    //   - memory is a list of unit entries with unit_id, holding_registers (start/count), and policy
    const targets = (system && system.targets) || [];
    const firstTarget = targets[0] || {};
    const endpointParts = (firstTarget.endpoint || 'mma:502').split(':');
    const port = Number(endpointParts[1]) || 502;

    const lines = [
        'listeners:',
        '  - id: main',
        `    listen: ":${port}"`,
        '    memory:'
    ];

    // Group reads by MMA unit_id to compute register ranges.
    const unitReads = {}; // unitId → [{source_address, source_count, source_area}]
    for (const device of devices) {
        const uid = Number(device.unitId);
        if (!Number.isFinite(uid)) continue;
        if (!unitReads[uid]) unitReads[uid] = [];
        for (const read of (device.reads || [])) {
            unitReads[uid].push({
                source_address: Number(read.source_address),
                source_count: Number(read.source_count),
                source_area: read.source_area,
            });
        }
    }

    const sortedUids = Object.keys(unitReads).map(Number).sort((a, b) => a - b);

    for (const uid of sortedUids) {
        const reads = unitReads[uid];
        // Only allocate for holding registers (FC3); coils/inputs are separate areas.
        const holdingReads = reads.filter(r => r.source_area === 'holding_registers');
        if (holdingReads.length > 0) {
            const start = Math.min(...holdingReads.map(r => r.source_address));
            const end = Math.max(...holdingReads.map(r => r.source_address + r.source_count));
            const count = end - start;
            lines.push(`      - unit_id: ${uid}`);
            lines.push(`        holding_registers:`);
            lines.push(`          start: ${start}`);
            lines.push(`          count: ${count}`);
            lines.push(`        policy:`);
            lines.push(`          rules:`);
            lines.push(`            - id: read-only`);
            lines.push(`              source_ip:`);
            lines.push(`                - 0.0.0.0/0`);
            lines.push(`                - ::/0`);
            lines.push(`              allow_fc: [3]`);
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
        if (!device.target_name) {
            return res.status(400).json({ error: 'device.target_name is required' });
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
            return res.status(400).json({ error: 'device.unitId must be a positive integer (MMA target unit)' });
        }
        const model = readModel();

        const target = model.system.targets.find(t => t.name === device.target_name);
        if (!target) {
            return res.status(400).json({ error: `Target "${device.target_name}" not found` });
        }

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
            target_name: device.target_name,
            status_slot: Number.isFinite(Number(device.status_slot)) ? Number(device.status_slot) : 0,
            reads: []
        });
        writeModel(model);
        autoCompile(model);

        res.status(201).json({ ok: true, unitId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /device/:id — update editable device fields (name, group, ipAddress, port, source_unit_id, unitId, target_name)
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
                return res.status(400).json({ error: 'device.unitId must be a positive integer (MMA target unit)' });
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
        if (device.target_name !== undefined) {
            const target = model.system.targets.find(t => t.name === device.target_name);
            if (!target) {
                return res.status(400).json({ error: `Target "${device.target_name}" not found` });
            }
            existing.target_name = device.target_name;
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

// PUT /system — update system settings (generic merge, targets preserved)
app.put('/system', (req, res) => {
    try {
        const { system } = req.body;
        if (!system) {
            return res.status(400).json({ error: 'system is required' });
        }
        const model = readModel();
        model.system = { ...model.system, ...system };
        if (!Array.isArray(model.system.targets)) model.system.targets = [];
        writeModel(model);
        autoCompile(model);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /target — add a target destination (MMA 2.0 runtime endpoint)
app.post('/target', (req, res) => {
    try {
        const { target } = req.body;
        if (!target || !target.name) {
            return res.status(400).json({ error: 'target.name is required' });
        }
        const port = Number(target.port);
        if (!Number.isFinite(port) || port < 1 || port > 65535) {
            return res.status(400).json({ error: 'target.port must be a valid port number (1–65535)' });
        }

        const model = readModel();
        const exists = model.system.targets.some(t => t.name === target.name);
        if (exists) {
            return res.status(409).json({ error: `Target "${target.name}" already exists` });
        }

        model.system.targets.push({
            name: target.name,
            // `endpoint` is kept for internal use by the YAML compiler (toReplicatorYaml / toMmaYaml).
            // `port` is the canonical user-facing value.
            endpoint: `${TARGET_HOST}:${port}`,
            port,
            status_unit_id: target.status_unit_id != null ? Number(target.status_unit_id) : null,
        });
        writeModel(model);
        autoCompile(model);
        res.status(201).json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /target/:name — remove a target (only if no devices reference it)
app.delete('/target/:name', (req, res) => {
    try {
        const name = decodeURIComponent(req.params.name);
        const model = readModel();

        const idx = model.system.targets.findIndex(t => t.name === name);
        if (idx === -1) {
            return res.status(404).json({ error: `Target "${name}" not found` });
        }

        const inUse = (model.devices || []).some(d => d.target_name === name);
        if (inUse) {
            return res.status(409).json({ error: `Target "${name}" is in use by one or more devices` });
        }

        model.system.targets.splice(idx, 1);
        writeModel(model);
        autoCompile(model);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /target/:name — update an existing target's port (and optional status_unit_id)
app.put('/target/:name', (req, res) => {
    try {
        const name = decodeURIComponent(req.params.name);
        const { target } = req.body;
        if (!target) {
            return res.status(400).json({ error: 'target is required' });
        }
        const model = readModel();
        const existing = model.system.targets.find(t => t.name === name);
        if (!existing) {
            return res.status(404).json({ error: `Target "${name}" not found` });
        }
        if (target.port !== undefined) {
            const port = Number(target.port);
            if (!Number.isFinite(port) || port < 1 || port > 65535) {
                return res.status(400).json({ error: 'target.port must be a valid port number (1–65535)' });
            }
            existing.port = port;
            existing.endpoint = `${TARGET_HOST}:${port}`;
        }
        if (target.status_unit_id !== undefined) {
            existing.status_unit_id = target.status_unit_id != null ? Number(target.status_unit_id) : null;
        }
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
 * Compile model → YAML and write to disk.
 * Returns { ok, mmaErrors, replicatorErrors }.
 * Does NOT throw — callers that want to surface errors should check the return value.
 */
function compileAndWrite(model) {
    const system = model.system || DEFAULT_SYSTEM;
    const devices = model.devices || [];
    const replicatorYaml = toReplicatorYaml(system, devices);
    const mmaYaml = toMmaYaml(system, devices);
    const mmaErrors = validateMmaConfig(mmaYaml);
    const replicatorErrors = validateReplicatorConfig(replicatorYaml);
    if (mmaErrors.length > 0 || replicatorErrors.length > 0) {
        return { ok: false, mmaErrors, replicatorErrors };
    }
    atomicWrite(REPLICATOR_CONFIG_PATH, replicatorYaml);
    atomicWrite(MMA_CONFIG_PATH, mmaYaml);
    return { ok: true };
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

        res.json({ ok: true, routes: routeCount });
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