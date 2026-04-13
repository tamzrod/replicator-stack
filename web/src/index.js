const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const DATA_DIR = process.env.DATA_DIR || '/app/data';
const MODEL_PATH = path.join(DATA_DIR, 'model.json');
const REPLICATOR_CONFIG_PATH = path.join(DATA_DIR, 'replicator/config.yaml');
const MMA_CONFIG_PATH = path.join(DATA_DIR, 'mma/config.yaml');

const DEFAULT_SYSTEM = {
    mma: {
        host: 'mma',
        port: 502,
        unit_memory_size: 100,
        status_unit_id: 100,
        status_slot_size: 10
    }
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readModel() {
    if (!fs.existsSync(MODEL_PATH)) {
        const initial = { system: DEFAULT_SYSTEM, devices: [] };
        writeModel(initial);
        return initial;
    }
    return JSON.parse(fs.readFileSync(MODEL_PATH, 'utf-8'));
}

function writeModel(model) {
    atomicWrite(MODEL_PATH, JSON.stringify(model, null, 2));
}

function atomicWrite(filePath, content) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(os.tmpdir(), `atomic-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.writeFileSync(tmp, content, 'utf-8');
    fs.renameSync(tmp, filePath);
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

function nextAssignedUnitId(model) {
    const statusUnitId = (model.system && model.system.mma) ? model.system.mma.status_unit_id : 100;
    const used = (model.devices || []).map(d => d.assigned_unit_id).filter(Number.isFinite);
    let next = 1;
    while (used.includes(next) || next === statusUnitId) next++;
    return next;
}

function nextStatusSlot(model) {
    const used = (model.devices || []).map(d => d.status_slot).filter(Number.isFinite);
    let next = 0;
    while (used.includes(next)) next++;
    return next;
}

function toReplicatorYaml(system, devices) {
    const mma = (system && system.mma) || {};
    const host = mma.host || 'mma';
    const port = mma.port || 502;
    const indent = '  ';
    const lines = [
        'mma:',
        `${indent}host: ${host}`,
        `${indent}port: ${port}`,
        '',
        'routes:'
    ];
    for (const device of devices) {
        for (const read of (device.reads || [])) {
            const routeId = `${device.id}__${read.id}`;
            lines.push(`${indent}- id: ${routeId}`);
            lines.push(`${indent}  source:`);
            lines.push(`${indent}    host: ${device.host}`);
            lines.push(`${indent}    port: ${device.port}`);
            lines.push(`${indent}    unit_id: ${device.source_unit_id}`);
            lines.push(`${indent}    area: ${read.source_area}`);
            lines.push(`${indent}    address: ${read.source_address}`);
            lines.push(`${indent}    count: ${read.source_count}`);
            lines.push(`${indent}  target:`);
            lines.push(`${indent}    unit: ${device.assigned_unit_id}`);
            lines.push(`${indent}    area: ${read.target_area}`);
            lines.push(`${indent}    address: ${read.target_address}`);
            lines.push(`${indent}  poll_interval: ${read.poll_interval}`);
            lines.push(`${indent}  ref:`);
            lines.push(`${indent}    device_id: ${device.id}`);
            lines.push(`${indent}    read_id: ${read.id}`);
        }
    }
    return lines.join('\n') + '\n';
}

function toMmaYaml(system, devices) {
    const mma = (system && system.mma) || {};
    const port = mma.port || 502;
    const unitMemorySize = mma.unit_memory_size || 100;
    const statusUnitId = mma.status_unit_id || 100;
    const statusSlotSize = mma.status_slot_size || 10;
    const statusSize = statusSlotSize * devices.length;
    const indent = '  ';
    const lines = [
        `port: ${port}`,
        '',
        'units:'
    ];
    for (const device of devices) {
        lines.push(`${indent}- id: ${device.assigned_unit_id}`);
        lines.push(`${indent}  size: ${unitMemorySize}`);
    }
    if (devices.length > 0) {
        lines.push(`${indent}- id: ${statusUnitId}`);
        lines.push(`${indent}  size: ${statusSize}`);
    }
    return lines.join('\n') + '\n';
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

// POST /device — add device with auto-assigned unit_id and status_slot
app.post('/device', (req, res) => {
    try {
        const { device } = req.body;
        if (!device || !device.id) {
            return res.status(400).json({ error: 'device.id is required' });
        }

        const model = readModel();

        const exists = (model.devices || []).some(d => d.id === device.id);
        if (exists) {
            return res.status(409).json({ error: `Device ${device.id} already exists` });
        }

        const assigned_unit_id = nextAssignedUnitId(model);
        const status_slot = nextStatusSlot(model);

        model.devices.push({
            id: device.id,
            name: device.name || '',
            host: device.host,
            port: device.port,
            source_unit_id: device.source_unit_id,
            assigned_unit_id,
            status_slot,
            reads: []
        });
        writeModel(model);

        res.status(201).json({ ok: true, assigned_unit_id, status_slot });
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

        for (const existing of device.reads) {
            if (readsOverlap(existing, read)) {
                return res.status(409).json({
                    error: `Read overlaps with existing read ${existing.id} in area ${existing.source_area}`
                });
            }
        }

        device.reads.push(read);
        writeModel(model);

        res.status(201).json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /compile — generate replicator/config.yaml and mma/config.yaml from model
app.post('/compile', (req, res) => {
    try {
        const model = readModel();
        const system = model.system || DEFAULT_SYSTEM;
        const devices = model.devices || [];

        let routeCount = 0;
        for (const device of devices) {
            routeCount += (device.reads || []).length;
        }

        atomicWrite(REPLICATOR_CONFIG_PATH, toReplicatorYaml(system, devices));
        atomicWrite(MMA_CONFIG_PATH, toMmaYaml(system, devices));

        res.json({ ok: true, routes: routeCount });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------

app.listen(8080, () => {
    console.log('Web running on 8080');
});