const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
app.use(express.json());

const MODEL_PATH = '/app/data/model.json';
const REPLICATOR_CONFIG_PATH = '/app/data/replicator/config.yaml';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readModel() {
    if (!fs.existsSync(MODEL_PATH)) {
        const initial = { groups: [] };
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

function blocksOverlap(a, b) {
    // Ranges [a.source_address, a.source_address + a.count) and the same for b
    if (a.source_area !== b.source_area) return false;
    const aStart = Number(a.source_address);
    const aEnd = aStart + Number(a.count);
    const bStart = Number(b.source_address);
    const bEnd = bStart + Number(b.count);
    if (!Number.isFinite(aStart) || !Number.isFinite(aEnd) ||
        !Number.isFinite(bStart) || !Number.isFinite(bEnd)) return false;
    return aStart < bEnd && bStart < aEnd;
}

function findDevice(model, deviceId) {
    for (const group of model.groups) {
        const device = group.devices.find(d => d.id === deviceId);
        if (device) return { device, group };
    }
    return null;
}

function toYaml(routes) {
    const indent = '  ';
    const lines = ['routes:'];
    for (const r of routes) {
        lines.push(`${indent}- id: ${r.id}`);
        lines.push(`${indent}  host: ${r.host}`);
        lines.push(`${indent}  port: ${r.port}`);
        lines.push(`${indent}  unit_id: ${r.unit_id}`);
        lines.push(`${indent}  source_area: ${r.source_area}`);
        lines.push(`${indent}  source_address: ${r.source_address}`);
        lines.push(`${indent}  count: ${r.count}`);
        lines.push(`${indent}  target_area: ${r.target_area}`);
        lines.push(`${indent}  target_address: ${r.target_address}`);
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

// POST /device — create group if not exists, add device with empty blocks
app.post('/device', (req, res) => {
    try {
        const { group: groupName, device } = req.body;
        if (!groupName || !device || !device.id) {
            return res.status(400).json({ error: 'group and device.id are required' });
        }

        const model = readModel();

        let group = model.groups.find(g => g.name === groupName);
        if (!group) {
            group = { name: groupName, devices: [] };
            model.groups.push(group);
        }

        const exists = group.devices.some(d => d.id === device.id);
        if (exists) {
            return res.status(409).json({ error: `Device ${device.id} already exists in group ${groupName}` });
        }

        group.devices.push({ ...device, blocks: [] });
        writeModel(model);

        res.status(201).json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /device/:id — remove device from all groups
app.delete('/device/:id', (req, res) => {
    try {
        const { id } = req.params;
        const model = readModel();

        const found = findDevice(model, id);
        if (!found) {
            return res.status(404).json({ error: `Device ${id} not found` });
        }

        found.group.devices = found.group.devices.filter(d => d.id !== id);
        writeModel(model);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /block — add block to device, validate no overlap in same area
app.post('/block', (req, res) => {
    try {
        const { device_id, block } = req.body;
        if (!device_id || !block || !block.id) {
            return res.status(400).json({ error: 'device_id and block.id are required' });
        }

        const model = readModel();

        const found = findDevice(model, device_id);
        if (!found) {
            return res.status(404).json({ error: `Device ${device_id} not found` });
        }
        const targetDevice = found.device;

        const blockExists = targetDevice.blocks.some(b => b.id === block.id);
        if (blockExists) {
            return res.status(409).json({ error: `Block ${block.id} already exists on device ${device_id}` });
        }

        for (const existing of targetDevice.blocks) {
            if (blocksOverlap(existing, block)) {
                return res.status(409).json({
                    error: `Block overlaps with existing block ${existing.id} in area ${existing.source_area}`
                });
            }
        }

        targetDevice.blocks.push(block);
        writeModel(model);

        res.status(201).json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /compile — generate flat routes and write to replicator config.yaml
app.post('/compile', (req, res) => {
    try {
        const model = readModel();
        const routes = [];

        for (const group of model.groups) {
            for (const device of group.devices) {
                for (const block of device.blocks) {
                    routes.push({
                        id: block.id,
                        host: device.host,
                        port: device.port,
                        unit_id: device.unit_id,
                        source_area: block.source_area,
                        source_address: block.source_address,
                        count: block.count,
                        target_area: block.target_area,
                        target_address: block.target_address
                    });
                }
            }
        }

        atomicWrite(REPLICATOR_CONFIG_PATH, toYaml(routes));
        res.json({ ok: true, routes: routes.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------

app.listen(8080, () => {
    console.log('Web running on 8080');
});