const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const net = require('net');
const { randomUUID, randomBytes } = require('crypto');

const { _sessions, SESSION_TTL_MS, SALT_BYTES, hashPassword, verifyPassword, readAuth, writeAuth, parseCookies, requireAuth } = require('./services/authService');
const { _idx, DATA_DIR, TARGET_HOST, MODEL_PATH, REPLICATOR_CONFIG_PATH, MMA_CONFIG_PATH, DEFAULT_SYSTEM, STATUS_SLOT_SIZE, DEFAULT_STATUS_UNIT_ID, getCanonicalVersion, getYamlHash, bumpCanonicalVersion, setYamlHash, invalidateCache, atomicWrite, readModel, writeModel, isRequiredNonNegativeInt, isValidIp, isValidEndpoint, endpointPort, getMissingTargetPorts, findGroup, findDevice, findMemoryPort, findUnit, readsOverlap, ensureTargetMemory, mergeSegments, makeDefaultPolicy, pickCanonicalSuid, getCanonicalStatusUnitId, assignNextSlot, recompileStatusSlots, csvCell, parseCSVRow, generateUniqueReadId } = require('./services/modelStore');
const { scheduleCompile, flushPendingCompile, autoCompile, mergeRanges, rehydrateFromYaml, resolveIdentityConflicts, autoFixDuplicateUnitIds, buildErrorSummary, compileAndWrite } = require('./services/compileService');
const { DOCKER_SOCKET, ALLOWED_SERVICES, DOCKER_LOG_TAIL_LINES, getAppVersion, getDockerDigest, dockerApi, restartServices, streamContainerLogs, discoverVersion } = require('./services/dockerService');
const { modbusReadHoldingRegisters, readDevicesStatus } = require('./services/modbusService');
const { validateMmaConfig, validateReplicatorConfig } = require('./services/yamlCompiler');
const { computeIntegrity } = require('./services/integrityService');
const { DEFAULT_STATE_SEALING_OVERRIDE, normalizeStateSealingOverrideConfig, StateSealingRuntime } = require('./services/stateSealingRuntimeService');

const GIT_SHA = process.env.GIT_SHA || null;
const VALID_AREA_TYPES = new Set(['holding_registers', 'input_registers', 'coils', 'discrete_inputs']);
const VALID_FC_SET = new Set([1, 2, 3, 4, 5, 6, 15, 16]);

// ---------------------------------------------------------------------------
// Access Events — constants, defaults, and validation
// ---------------------------------------------------------------------------

const REQUIRED_ACCESS_EVENT_KEY_FIELDS = ['src_ip', 'function_code', 'action', 'status', 'port', 'unit'];

function defaultAccessEventsConfig() {
    return {
        enabled: false,
        mode: 'rate',
        window: 5,
        key_fields: REQUIRED_ACCESS_EVENT_KEY_FIELDS.slice(),
        include_counter: true,
        limits: { max_keys: 1000, ttl: 30 },
        output: { type: 'http_stream', host: '', listen: ':9090', path: '/events' },
    };
}

/**
 * Validate an access_events config object per MMA2 manual rules.
 * When enabled is false, no field validation is performed.
 * @returns {string[]} array of error messages (empty = valid)
 */
function validateAccessEventsConfig(cfg) {
    const errors = [];
    if (!cfg || typeof cfg !== 'object') return ['Config must be an object'];
    // Validation only applies when enabled
    if (!cfg.enabled) return errors;

    if (cfg.mode !== 'rate') errors.push('mode must be "rate"');

    const win = Number(cfg.window);
    if (!Number.isFinite(win) || !Number.isInteger(win) || win <= 0) {
        errors.push('window must be a positive integer');
    }

    const kf = cfg.key_fields;
    if (!Array.isArray(kf) || kf.length !== 6) {
        errors.push('key_fields must contain exactly the 6 required fields');
    } else {
        const actual = new Set(kf);
        if (!REQUIRED_ACCESS_EVENT_KEY_FIELDS.every(f => actual.has(f)) || actual.size !== 6) {
            errors.push('key_fields must contain exactly: ' + REQUIRED_ACCESS_EVENT_KEY_FIELDS.join(', '));
        }
    }

    const maxKeys = Number(cfg.limits && cfg.limits.max_keys);
    if (!Number.isFinite(maxKeys) || !Number.isInteger(maxKeys) || maxKeys <= 0) {
        errors.push('limits.max_keys must be a positive integer');
    }

    const ttl = Number(cfg.limits && cfg.limits.ttl);
    if (!Number.isFinite(ttl) || !Number.isInteger(ttl) || ttl < 0) {
        errors.push('limits.ttl must be a non-negative integer');
    } else if (Number.isFinite(win) && win > 0 && ttl < 2 * win) {
        errors.push(`limits.ttl must be >= 2 × window (minimum: ${2 * win})`);
    }

    if (!cfg.output || cfg.output.type !== 'http_stream') {
        errors.push('output.type must be "http_stream"');
    }

    const outPath = cfg.output && cfg.output.path;
    if (typeof outPath !== 'string' || !outPath.startsWith('/')) {
        errors.push('output.path must start with "/"');
    }

    const listen = cfg.output && cfg.output.listen;
    if (!listen || typeof listen !== 'string' || !listen.trim()) {
        errors.push('output.listen must not be empty');
    }

    return errors;
}

const _stateSealingRuntime = new StateSealingRuntime();
const STATE_SEALING_POLL_INTERVAL_MS = 5000;
let _stateSealingPollActive = false;

function findUnitStateSealing(model, device) {
    const portNum = endpointPort(device.target_endpoint);
    if (portNum == null) return null;
    const ports = (model.memory && model.memory.ports) || [];
    const port = ports.find(p => Number(p.port) === Number(portNum));
    if (!port) return null;
    const unit = (port.units || []).find(u => Number(u.unit_id) === Number(device.unitId));
    if (!unit || !unit.state_sealing || unit.state_sealing.area !== 'coil') return null;
    return unit.state_sealing;
}

function applyStateSealingOverrides(model, statusByDeviceId, emitLogs) {
    const cfg = normalizeStateSealingOverrideConfig((model.system || {}).state_sealing_override || DEFAULT_STATE_SEALING_OVERRIDE);
    for (const device of (model.devices || [])) {
        const status = statusByDeviceId[device.id] || null;
        const hasSealing = !!findUnitStateSealing(model, device);
        const evalResult = _stateSealingRuntime.evaluate(device.id, status, cfg);
        const stateSealing = {
            enabled: cfg.enabled,
            has_sealing_config: hasSealing,
            forced_state: evalResult.forcedState,
            override_active: hasSealing ? evalResult.overrideActive : false,
            effective_state: hasSealing ? evalResult.effectiveState : 'live',
            reason_code: hasSealing ? evalResult.reasonCode : null,
        };

        const existing = Object.prototype.hasOwnProperty.call(statusByDeviceId, device.id)
            ? statusByDeviceId[device.id]
            : {};
        Object.defineProperty(statusByDeviceId, device.id, {
            value: { ...existing, state_sealing: stateSealing },
            writable: true,
            configurable: true,
            enumerable: true,
        });

        if (!emitLogs || !hasSealing || !evalResult.transition) continue;
        if (evalResult.transition === 'forced') {
            console.log(JSON.stringify({
                event: 'state_sealing.override_forced',
                device_id: device.id,
                reason_code: evalResult.reasonCode,
                forced_state: evalResult.forcedState,
                message: `Device ${device.id} unhealthy -> forcing ${evalResult.forcedState} state`,
            }));
        } else if (evalResult.transition === 'recovered') {
            console.log(JSON.stringify({
                event: 'state_sealing.override_cleared',
                device_id: device.id,
                message: `Device ${device.id} recovered -> restoring live state`,
            }));
        }
    }
}

function makeRateLimiter(windowMs, max) {
    const hits = new Map();
    return (req, res, next) => {
        const ip = req.ip;
        const now = Date.now();
        const entry = hits.get(ip) || { count: 0, start: now };
        if (now - entry.start > windowMs) { entry.count = 0; entry.start = now; }
        entry.count++;
        hits.set(ip, entry);
        if (entry.count > max) return res.status(429).json({ error: 'Too many requests' });
        next();
    };
}
const authRateLimit = makeRateLimiter(15 * 60 * 1000, 20);
const rateLimit    = makeRateLimiter(60 * 1000, 60);

/**
 * APPLY integrity gate — call before any APPLY operation.
 *
 * Runs computeIntegrity(model).  If the result is not ok, sends a 422 response
 * with the standard integrity_failed shape and returns true so the caller can
 * `return` immediately.  Returns false when integrity passes.
 *
 * @param {object} model
 * @param {object} res  - Express response object
 * @returns {boolean}  true → caller should return; false → proceed with APPLY
 */
function applyIntegrityGate(model, res) {
    const integrity = computeIntegrity(model);
    if (!integrity.ok) {
        const errorMessages = integrity.issues
            .filter(i => i.severity === 'error')
            .map(i => `[${i.deviceName}] ${i.message}`);
        res.status(422).json({
            status: 'integrity_failed',
            error: 'APPLY blocked — integrity CHECK failed. Run Fix Issues to resolve errors before applying.',
            integrity_errors: errorMessages,
            integrity: integrity,
        });
        return true;
    }
    return false;
}

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

const app = express();
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const INDEX_HTML = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
app.use(express.json());
app.use(express.static(PUBLIC_DIR));
app.get('/tools/modprobe', requireAuth, rateLimit, (req, res) => {
    res.type('html').send(INDEX_HTML);
});
app.use(requireAuth);

// ── Auth routes (public — no requireAuth) ──────────────────────────────────

// GET /auth/status — check session validity and return login state
app.get('/auth/status', authRateLimit, (req, res) => {
    const token = parseCookies(req)['mcs_session'];
    if (!token || !_sessions.has(token)) {
        return res.json({ authenticated: false });
    }
    const session = _sessions.get(token);
    if (Date.now() - session.createdAt > SESSION_TTL_MS) {
        _sessions.delete(token);
        return res.json({ authenticated: false });
    }
    const auth = readAuth();
    res.json({
        authenticated: true,
        username: session.username,
        mustChangePassword: auth.mustChangePassword || false,
    });
});

// POST /auth/login — validate credentials and issue a session cookie
app.post('/auth/login', authRateLimit, (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }
    const auth = readAuth();
    if (username !== auth.username || !verifyPassword(password, auth)) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = randomUUID();
    _sessions.set(token, { username, createdAt: Date.now() });
    res.setHeader('Set-Cookie', `mcs_session=${token}; Path=/; HttpOnly; SameSite=Strict`);
    res.json({ ok: true, mustChangePassword: auth.mustChangePassword || false });
});

// POST /auth/logout — invalidate the current session
app.post('/auth/logout', (req, res) => {
    const token = parseCookies(req)['mcs_session'];
    if (token) _sessions.delete(token);
    res.setHeader('Set-Cookie', 'mcs_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    res.json({ ok: true });
});

// POST /auth/change-password — change the current user's password
app.post('/auth/change-password', authRateLimit, (req, res) => {
    const token = parseCookies(req)['mcs_session'];
    if (!token || !_sessions.has(token)) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'currentPassword and newPassword are required' });
    }
    if (newPassword.length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    const auth = readAuth();
    if (!verifyPassword(currentPassword, auth)) {
        return res.status(401).json({ error: 'Current password is incorrect' });
    }
    const newSalt = randomBytes(SALT_BYTES).toString('hex');
    auth.salt = newSalt;
    auth.hash = hashPassword(newPassword, newSalt);
    auth.mustChangePassword = false;
    writeAuth(auth);
    res.json({ ok: true });
});


app.get('/version', (req, res) => {
    res.json({ version: getAppVersion(), digest: getDockerDigest(), gitSha: GIT_SHA, canonicalVersion: getCanonicalVersion() });
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
app.get('/model/snapshot', rateLimit, (req, res) => {
    try {
        flushPendingCompile();
        const model = readModel();
        const replicatorYaml = fs.existsSync(REPLICATOR_CONFIG_PATH)
            ? fs.readFileSync(REPLICATOR_CONFIG_PATH, 'utf-8')
            : null;
        const mmaYaml = fs.existsSync(MMA_CONFIG_PATH)
            ? fs.readFileSync(MMA_CONFIG_PATH, 'utf-8')
            : null;
        res.json({
            model,
            canonicalVersion: getCanonicalVersion(),
            yamlHash: getYamlHash(),
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
        // status_unit_id is system-managed (not user-editable).  New devices inherit the canonical
        // status_unit_id already used by the endpoint group, or DEFAULT_STATUS_UNIT_ID when the
        // group has no assigned value yet.
        const newDevice = {
            id: generatedId,
            name: device.name || '',
            groupId: device.groupId || null,
            source_endpoint: device.source_endpoint.trim(),
            source_unit_id: sourceUnitId,
            target_endpoint: device.target_endpoint.trim(),
            unitId,
            status_slot: assignNextSlot(model, device.target_endpoint.trim()),
            status_unit_id: getCanonicalStatusUnitId(model, device.target_endpoint.trim()),
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
            // status_unit_id inherits the canonical value for the new endpoint group.
            status_slot: null,
            status_unit_id: getCanonicalStatusUnitId(model, newTargetEndpoint),
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
        const merged = { ...model.system, ...system };
        if (system.state_sealing_override !== undefined) {
            merged.state_sealing_override = normalizeStateSealingOverrideConfig(system.state_sealing_override);
        }
        model.system = merged;
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
        const { deviceId, sourceConfig, targetConfig, mmaEndpointConfig, stateSealingOverrideConfig } = req.body;

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
        if (stateSealingOverrideConfig !== undefined) {
            model.system = {
                ...model.system,
                state_sealing_override: normalizeStateSealingOverrideConfig(stateSealingOverrideConfig),
            };
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
        const newUnit = { id: randomUUID(), unit_id: unitIdNum, areas: [], policy: makeDefaultPolicy() };
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
            // MMA config merges units by unit_id, so apply state_sealing changes
            // across all units that currently share this unit_id on the same port.
            const effectiveUnitId = Number(existing.unit_id);
            const matchedTargets = Number.isFinite(effectiveUnitId)
                ? (port.units || []).filter(u => Number(u.unit_id) === effectiveUnitId)
                : [];
            const targets = matchedTargets.length > 0 ? matchedTargets : [existing];
            for (const target of targets) {
                if (stateSealingValue === null) {
                    delete target.state_sealing;
                } else {
                    target.state_sealing = stateSealingValue;
                }
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

        // Accept segments[] as primary format; accept legacy start+count for backward compat.
        let segments;
        if (Array.isArray(area.segments) && area.segments.length > 0) {
            for (const seg of area.segments) {
                const s = Number(seg.start);
                const c = Number(seg.count);
                if (!Number.isFinite(s) || s < 0) {
                    return res.status(400).json({ error: 'Each segment.start must be a non-negative integer' });
                }
                if (!Number.isFinite(c) || c < 1) {
                    return res.status(400).json({ error: 'Each segment.count must be a positive integer' });
                }
            }
            segments = area.segments.map(s => ({ start: Number(s.start), count: Number(s.count) }));
        } else if (area.start !== undefined || area.count !== undefined) {
            const start = Number(area.start);
            const count = Number(area.count);
            if (!Number.isFinite(start) || start < 0) {
                return res.status(400).json({ error: 'area.start must be a non-negative integer' });
            }
            if (!Number.isFinite(count) || count < 1) {
                return res.status(400).json({ error: 'area.count must be a positive integer' });
            }
            segments = [{ start, count }];
        } else {
            return res.status(400).json({ error: 'area.segments (array) or area.start + area.count required' });
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
        // If an area of the same type already exists, append segments (no auto-merge).
        const existingArea = (unit.areas || []).find(a => a.type === areaType);
        if (existingArea) {
            if (!Array.isArray(existingArea.segments)) existingArea.segments = [];
            existingArea.segments.push(...segments);
            writeModel(model);
            scheduleCompile();
            return res.status(200).json({ ok: true, id: existingArea.id, appended: true });
        }
        const newArea = { id: randomUUID(), type: areaType, segments };
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
            existing.type = area.type;
        }
        if (area.segments !== undefined) {
            if (!Array.isArray(area.segments) || area.segments.length === 0) {
                return res.status(400).json({ error: 'area.segments must be a non-empty array' });
            }
            for (const seg of area.segments) {
                const s = Number(seg.start);
                const c = Number(seg.count);
                if (!Number.isFinite(s) || s < 0) {
                    return res.status(400).json({ error: 'Each segment.start must be a non-negative integer' });
                }
                if (!Number.isFinite(c) || c < 1) {
                    return res.status(400).json({ error: 'Each segment.count must be a positive integer' });
                }
            }
            existing.segments = area.segments.map(s => ({ start: Number(s.start), count: Number(s.count) }));
        }
        if (area.mode !== undefined) {
            if (area.mode === null || area.mode === '') {
                delete existing.mode;
            } else {
                existing.mode = area.mode;
            }
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

// Helper: detect the first overlapping pair in a segments array.
// Returns { a: labelA, b: labelB } or null when all segments are non-overlapping.
function checkSegmentOverlaps(segments) {
    if (!Array.isArray(segments) || segments.length < 2) return null;
    const tagged = segments.map((s, i) => ({
        i,
        label: s.name || `HR_${i}`,
        start: s.start,
        end: s.start + s.count - 1,
    })).sort((x, y) => x.start - y.start || x.end - y.end);
    for (let i = 0; i < tagged.length - 1; i++) {
        if (tagged[i].end >= tagged[i + 1].start) {
            return { a: tagged[i].label, b: tagged[i + 1].label };
        }
    }
    return null;
}

// POST /memory/port/:portId/unit/:unitId/area/:areaId/segment — add a segment to an area
app.post('/memory/port/:portId/unit/:unitId/area/:areaId/segment', (req, res) => {
    try {
        const { portId, unitId, areaId } = req.params;
        const { segment } = req.body;
        const start = Number(segment && segment.start);
        const count = Number(segment && segment.count);
        if (!Number.isFinite(start) || start < 0) {
            return res.status(400).json({ error: 'segment.start must be a non-negative integer' });
        }
        if (!Number.isFinite(count) || count < 1) {
            return res.status(400).json({ error: 'segment.count must be a positive integer' });
        }
        const model = readModel();
        const port = findMemoryPort(model, portId);
        if (!port) return res.status(404).json({ error: `Memory port ${portId} not found` });
        const unit = findUnit(port, unitId);
        if (!unit) return res.status(404).json({ error: `Unit ${unitId} not found on port ${portId}` });
        const area = (unit.areas || []).find(a => a.id === areaId);
        if (!area) return res.status(404).json({ error: `Area ${areaId} not found on unit ${unitId}` });
        if (!Array.isArray(area.segments)) area.segments = [];
        const newSeg = { start, count };
        if (segment.name !== undefined) newSeg.name = String(segment.name).trim() || undefined;
        area.segments.push(newSeg);
        const collision = checkSegmentOverlaps(area.segments);
        if (collision) {
            area.segments.pop();
            return res.status(409).json({ error: `Segment "${collision.a}" overlaps with segment "${collision.b}"` });
        }
        writeModel(model);
        scheduleCompile();
        res.status(201).json({ ok: true, segmentIndex: area.segments.length - 1 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /memory/port/:portId/unit/:unitId/area/:areaId/segment/:segIdx — update a segment
app.put('/memory/port/:portId/unit/:unitId/area/:areaId/segment/:segIdx', (req, res) => {
    try {
        const { portId, unitId, areaId, segIdx } = req.params;
        const { segment } = req.body;
        const idx = Number(segIdx);
        if (!Number.isFinite(idx) || idx < 0) {
            return res.status(400).json({ error: 'segIdx must be a non-negative integer' });
        }
        const model = readModel();
        const port = findMemoryPort(model, portId);
        if (!port) return res.status(404).json({ error: `Memory port ${portId} not found` });
        const unit = findUnit(port, unitId);
        if (!unit) return res.status(404).json({ error: `Unit ${unitId} not found on port ${portId}` });
        const area = (unit.areas || []).find(a => a.id === areaId);
        if (!area) return res.status(404).json({ error: `Area ${areaId} not found on unit ${unitId}` });
        if (!Array.isArray(area.segments) || idx >= area.segments.length) {
            return res.status(404).json({ error: `Segment index ${idx} not found on area ${areaId}` });
        }
        if (segment.start !== undefined) {
            const start = Number(segment.start);
            if (!Number.isFinite(start) || start < 0) {
                return res.status(400).json({ error: 'segment.start must be a non-negative integer' });
            }
            area.segments[idx].start = start;
        }
        if (segment.count !== undefined) {
            const count = Number(segment.count);
            if (!Number.isFinite(count) || count < 1) {
                return res.status(400).json({ error: 'segment.count must be a positive integer' });
            }
            area.segments[idx].count = count;
        }
        if (segment.name !== undefined) {
            const name = String(segment.name).trim();
            if (name) {
                area.segments[idx].name = name;
            } else {
                delete area.segments[idx].name;
            }
        }
        const collision = checkSegmentOverlaps(area.segments);
        if (collision) {
            return res.status(409).json({ error: `Segment "${collision.a}" overlaps with segment "${collision.b}"` });
        }
        writeModel(model);
        scheduleCompile();
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /memory/port/:portId/unit/:unitId/area/:areaId/segment/:segIdx — remove a segment
app.delete('/memory/port/:portId/unit/:unitId/area/:areaId/segment/:segIdx', (req, res) => {
    try {
        const { portId, unitId, areaId, segIdx } = req.params;
        const idx = Number(segIdx);
        if (!Number.isFinite(idx) || idx < 0) {
            return res.status(400).json({ error: 'segIdx must be a non-negative integer' });
        }
        const model = readModel();
        const port = findMemoryPort(model, portId);
        if (!port) return res.status(404).json({ error: `Memory port ${portId} not found` });
        const unit = findUnit(port, unitId);
        if (!unit) return res.status(404).json({ error: `Unit ${unitId} not found on port ${portId}` });
        const area = (unit.areas || []).find(a => a.id === areaId);
        if (!area) return res.status(404).json({ error: `Area ${areaId} not found on unit ${unitId}` });
        if (!Array.isArray(area.segments) || idx >= area.segments.length) {
            return res.status(404).json({ error: `Segment index ${idx} not found on area ${areaId}` });
        }
        if (area.segments.length === 1) {
            return res.status(400).json({ error: 'Cannot remove the last segment — delete the area instead' });
        }
        area.segments.splice(idx, 1);
        writeModel(model);
        scheduleCompile();
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /memory/port/:portId/unit/:unitId/area/:areaId/merge-segments
// Merge all segments of an area into a single contiguous block (user-triggered only).
// Sets area.mode = "merged" to record the intent.
app.post('/memory/port/:portId/unit/:unitId/area/:areaId/merge-segments', (req, res) => {
    try {
        const { portId, unitId, areaId } = req.params;
        const model = readModel();
        const port = findMemoryPort(model, portId);
        if (!port) return res.status(404).json({ error: `Memory port ${portId} not found` });
        const unit = findUnit(port, unitId);
        if (!unit) return res.status(404).json({ error: `Unit ${unitId} not found on port ${portId}` });
        const area = (unit.areas || []).find(a => a.id === areaId);
        if (!area) return res.status(404).json({ error: `Area ${areaId} not found on unit ${unitId}` });
        if (!Array.isArray(area.segments) || area.segments.length === 0) {
            return res.status(400).json({ error: 'Area has no segments to merge' });
        }
        area.segments = mergeSegments(area.segments);
        area.mode = 'merged';
        writeModel(model);
        scheduleCompile();
        res.json({ ok: true, segment: area.segments[0] });
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
        // Group blocks by unit_id; within each unit group by area type,
        // collecting individual segment ranges (no merging).
        const derivedByUnitId = new Map();
        for (const block of (port.blocks || [])) {
            const uid = Number(block.unit_id);
            if (!derivedByUnitId.has(uid)) {
                derivedByUnitId.set(uid, new Map()); // area type → segments[]
            }
            const areaMap = derivedByUnitId.get(uid);
            const areaType = block.area || 'holding_registers';
            if (!areaMap.has(areaType)) areaMap.set(areaType, []);
            areaMap.get(areaType).push({ start: block.address, count: block.count });
        }

        let added = 0;
        for (const [uid, areaMap] of derivedByUnitId) {
            const areas = [...areaMap.entries()].map(([type, segments]) => ({
                id: randomUUID(),
                type,
                segments,
            }));

            if (existingByUnitId.has(uid)) {
                // Merge areas into existing unit.  Append new segments to existing
                // areas of the same type; create new areas for types not yet present.
                const existing = existingByUnitId.get(uid);
                for (const area of areas) {
                    const existingArea = (existing.areas || []).find(a => a.type === area.type);
                    if (existingArea) {
                        if (!Array.isArray(existingArea.segments)) existingArea.segments = [];
                        existingArea.segments.push(...area.segments);
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
                // is actually covered by at least one segment of the unit area.
                const rangeIssues = [];
                for (const read of (device.reads || [])) {
                    const areaType = read.source_area || 'holding_registers';
                    if (!configuredAreas.has(areaType)) continue; // already flagged as missing
                    const readStart = Number(read.source_address);
                    const readCount = Number(read.source_count) || 1;
                    // FC1 (coils) and FC2 (discrete_inputs/input_status) with addinvert=true
                    // reserve double the address space — verify the full expanded footprint is covered.
                    const effectiveReadCount = read.addinvert && (areaType === 'coils' || areaType === 'discrete_inputs' || areaType === 'input_status')
                        ? readCount * 2
                        : readCount;
                    const readEnd = readStart + effectiveReadCount - 1;
                    const matchingAreas = (unit.areas || []).filter(a => a.type === areaType);
                    // A read is covered if any segment in any matching area fully contains it.
                    const covered = matchingAreas.some(a =>
                        (a.segments || []).some(seg => {
                            const sStart = Number(seg.start);
                            const sEnd = sStart + Number(seg.count) - 1;
                            return sStart <= readStart && sEnd >= readEnd;
                        })
                    );
                    if (!covered) {
                        const bestArea = matchingAreas[0] || null;
                        const bestSeg = (bestArea && bestArea.segments && bestArea.segments[0]) || null;
                        rangeIssues.push({
                            readId: read.id,
                            readName: read.name || read.id,
                            areaType,
                            readStart,
                            readEnd,
                            areaSegments: bestArea ? (bestArea.segments || []) : [],
                            areaStart: bestSeg != null ? Number(bestSeg.start) : null,
                            areaEnd: bestSeg != null ? Number(bestSeg.start) + Number(bestSeg.count) - 1 : null,
                            areaCount: bestSeg != null ? Number(bestSeg.count) : null,
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

            if (!portEntry) {
                // The memory port itself does not exist — no MMA listener will be emitted
                // for this port at all, so status memory cannot be auto-generated.
                status_missing.push({
                    statusUnitId,
                    portNum,
                    portId: null,
                    deviceCount,
                    requiredCount,
                    devices: groupDevices,
                });
            } else if (unit) {
                // Unit explicitly stored in port.units[] — verify it has a correctly-sized
                // holding_registers area: at least one segment with start=0 and
                // count >= requiredCount.
                const hrAreas = (unit.areas || []).filter(a => a.type === 'holding_registers');
                const hrArea = hrAreas[0] || null;
                const firstSeg = hrArea && (hrArea.segments || [])[0] || null;
                const configuredStart = firstSeg != null ? Number(firstSeg.start) : null;
                const configuredCount = firstSeg != null ? Number(firstSeg.count) : null;
                const sizeOk = hrArea != null && (hrArea.segments || []).some(
                    seg => Number(seg.start) === 0 && Number(seg.count) >= requiredCount
                );
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

        // Identify all target_endpoints on this port that have devices with the
        // requested status_unit_id — then extend the fix to ALL devices on those
        // endpoints (including any that currently have null or a different value).
        const affectedEndpoints = new Set(
            devices
                .filter(d => d.status_unit_id != null &&
                    Number(d.status_unit_id) === statusUnitId &&
                    endpointPort(d.target_endpoint) === portNum)
                .map(d => (d.target_endpoint || '').trim().toLowerCase())
        );

        if (affectedEndpoints.size === 0) {
            return res.status(404).json({ error: `No devices found with status_unit_id ${statusUnitId} targeting port ${portNum}` });
        }

        // Update ALL devices on the affected endpoints to share the same status_unit_id.
        const affectedDevices = devices.filter(d =>
            affectedEndpoints.has((d.target_endpoint || '').trim().toLowerCase())
        );
        for (const d of affectedDevices) {
            d.status_unit_id = statusUnitId;
        }
        const deviceCount = affectedDevices.length;

        const requiredCount = deviceCount * STATUS_SLOT_SIZE;

        // Find or create the memory port.
        let port = _idx.portsByNumber.get(portNum) || null;
        if (!port) {
            port = { id: randomUUID(), port: portNum, blocks: [], units: [] };
            model.memory.ports.push(port);
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

        // Add the correctly-sized holding_registers area using segments format.
        unit.areas.push({
            id: randomUUID(),
            type: 'holding_registers',
            segments: [{ start: 0, count: requiredCount }],
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
        // invert / addinvert are only valid for FC1/FC2 (coils / discrete_inputs)
        const digitalAreas = new Set(['coils', 'discrete_inputs']);
        if (digitalAreas.has(existing.source_area)) {
            if (read.invert !== undefined)    existing.invert    = Boolean(read.invert);
            if (read.addinvert !== undefined) existing.addinvert = Boolean(read.addinvert);
            // enforce mutual exclusion
            if (existing.invert && existing.addinvert) existing.addinvert = false;
        } else {
            // strip flags that are not applicable for FC3/FC4
            delete existing.invert;
            delete existing.addinvert;
        }
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

        const imported = [];
        const errors = [];

        for (let i = 1; i < lines.length; i++) {
            const cols = parseCSVRow(lines[i]);
            const name          = (cols[colIdx.name] || '').trim();
            const source_area   = (cols[colIdx.source_area] || '').trim();
            const source_address = Number(cols[colIdx.source_address]);
            const source_count  = Number(cols[colIdx.count]);
            const poll_interval = Number(cols[colIdx.poll_interval_ms]);

            if (!VALID_AREA_TYPES.has(source_area)) {
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
app.get('/config', rateLimit, (req, res) => {
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
// Global Config Import / Export
// ---------------------------------------------------------------------------

// GET /config/global-export — export full model as a unified versioned config envelope.
// The envelope contains the raw model.json together with a ui section for any
// UI-specific state that is not stored in the model.  The format is:
//
//   {
//     "version": "global-config/v1",
//     "exported_at": "<ISO-8601 timestamp>",
//     "model": { ...model.json content... },
//     "ui": { "layout": { "groups": [] }, "preferences": {} }
//   }
//
// The model section includes:
//   - model.groups     → replicator group / UI topology
//   - model.devices    → replicator device + read definitions
//   - model.memory     → MMA listener / memory layout
//   - model.system     → system-level overrides (e.g. mma_endpoint)
//
// The file is served as a downloadable attachment named "global-config.json".
app.get('/config/global-export', rateLimit, (req, res) => {
    try {
        const model = readModel();
        const envelope = {
            version: 'global-config/v1',
            exported_at: new Date().toISOString(),
            model: {
                system:  model.system  || {},
                groups:  model.groups  || [],
                devices: model.devices || [],
                memory:  model.memory  || { ports: [] },
            },
            ui: {
                layout: {
                    groups: (model.groups || []).map(g => ({ id: g.id, name: g.name })),
                },
                preferences: {},
            },
        };
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="global-config.json"');
        res.json(envelope);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /config/global-import — restore model from a global config envelope.
//
// Accepted body: the JSON object produced by GET /config/global-export.
//
// Validation:
//   - version must equal "global-config/v1"
//   - model.devices, model.groups, model.memory.ports must be arrays
//   - each device must have a valid source_endpoint, target_endpoint, source_unit_id, and unitId
//   - system-managed fields (status_slot, status_unit_id) are stripped and recomputed
//
// On success, the imported model replaces the current model.json and a
// background compile is scheduled.  The response includes counts of imported
// devices, groups, and memory ports.
app.post('/config/global-import', rateLimit, (req, res) => {
    try {
        const body = req.body;

        // Validate envelope version
        if (!body || body.version !== 'global-config/v1') {
            return res.status(400).json({
                error: 'Invalid global config: missing or unsupported version — expected "global-config/v1"',
            });
        }

        const importedModel = body.model;
        if (!importedModel || typeof importedModel !== 'object' || Array.isArray(importedModel)) {
            return res.status(400).json({ error: 'Invalid global config: model section is missing or not an object' });
        }

        // Validate structural requirements
        if (!Array.isArray(importedModel.devices)) {
            return res.status(400).json({ error: 'Invalid global config: model.devices must be an array' });
        }
        if (!Array.isArray(importedModel.groups)) {
            return res.status(400).json({ error: 'Invalid global config: model.groups must be an array' });
        }
        if (!importedModel.memory || !Array.isArray(importedModel.memory.ports)) {
            return res.status(400).json({ error: 'Invalid global config: model.memory.ports must be an array' });
        }

        // Validate each device has the required topology fields
        for (const device of importedModel.devices) {
            if (!device.id || typeof device.id !== 'string') {
                return res.status(400).json({ error: 'Invalid global config: each device must have a string id' });
            }
            if (!isValidEndpoint(device.source_endpoint)) {
                return res.status(400).json({
                    error: `Invalid global config: device "${device.id}" has an invalid source_endpoint`,
                });
            }
            if (!isValidEndpoint(device.target_endpoint)) {
                return res.status(400).json({
                    error: `Invalid global config: device "${device.id}" has an invalid target_endpoint`,
                });
            }
            if (!isRequiredNonNegativeInt(device.source_unit_id)) {
                return res.status(400).json({
                    error: `Invalid global config: device "${device.id}" has an invalid source_unit_id`,
                });
            }
            if (!isRequiredNonNegativeInt(device.unitId)) {
                return res.status(400).json({
                    error: `Invalid global config: device "${device.id}" has an invalid unitId`,
                });
            }
        }

        // Validate each group has an id and name
        for (const group of importedModel.groups) {
            if (!group.id || typeof group.id !== 'string') {
                return res.status(400).json({ error: 'Invalid global config: each group must have a string id' });
            }
            if (typeof group.name !== 'string') {
                return res.status(400).json({ error: `Invalid global config: group "${group.id}" must have a string name` });
            }
        }

        // Validate each memory port has a numeric port number
        for (const port of importedModel.memory.ports) {
            const portNum = Number(port && port.port);
            if (!Number.isFinite(portNum) || portNum < 1 || portNum > 65535) {
                return res.status(400).json({ error: 'Invalid global config: each memory port must have a valid port number (1–65535)' });
            }
        }

        // Strip system-managed status fields — they are recomputed below to
        // ensure correctness and prevent importing stale/invalid slot assignments.
        for (const device of importedModel.devices) {
            delete device.status_slot;
            delete device.status_unit_id;
            // Silently fix reads where both invert and addinvert are true (invalid state):
            // keep invert=true, set addinvert=false. Also strip flags from non-digital areas.
            const _digitalAreas = new Set(['coils', 'discrete_inputs']);
            for (const read of (device.reads || [])) {
                if (!_digitalAreas.has(read.source_area)) {
                    delete read.invert;
                    delete read.addinvert;
                } else if (read.invert && read.addinvert) {
                    read.addinvert = false;
                }
            }
        }

        // Normalise optional top-level fields
        if (!importedModel.system || typeof importedModel.system !== 'object') {
            importedModel.system = {};
        }

        // Ensure memory ports have the required blocks[] and units[] arrays.
        // blocks[] is the auto-derived list populated by rehydrateFromYaml on compile.
        // units[] is the manual unit-based config layer introduced in a later schema version.
        for (const port of importedModel.memory.ports) {
            if (!Array.isArray(port.blocks)) port.blocks = [];
            if (!Array.isArray(port.units))  port.units  = [];
        }

        // Reassign canonical status_unit_id for every device based on its
        // target_endpoint group, then compute slot indices.
        for (const device of importedModel.devices) {
            device.status_unit_id = getCanonicalStatusUnitId(importedModel, device.target_endpoint);
        }
        recompileStatusSlots(importedModel);

        writeModel(importedModel);
        scheduleCompile();

        res.json({
            ok: true,
            imported: {
                devices: importedModel.devices.length,
                groups:  importedModel.groups.length,
                ports:   importedModel.memory.ports.length,
            },
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

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
        if (applyIntegrityGate(model, res)) return;

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
            const { errors: restartErrors } = await restartServices(['mma', 'replicator']);
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
            // When NO device in the group has a status_unit_id yet, assign DEFAULT_STATUS_UNIT_ID.
            if (counts.size === 0) {
                let assigned = 0;
                for (const device of grpDevices) {
                    if (device.status_unit_id == null) {
                        device.status_unit_id = DEFAULT_STATUS_UNIT_ID;
                        assigned++;
                    }
                }
                if (assigned > 0) {
                    changes.push(`Endpoint "${endpoint}": assigned default status_unit_id ${DEFAULT_STATUS_UNIT_ID} to ${assigned} unassigned device(s)`);
                }
                continue;
            }

            // Choose the canonical value: highest count wins; lowest value breaks ties.
            const canonical = pickCanonicalSuid(counts, DEFAULT_STATUS_UNIT_ID);

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
// Access Events — config and NDJSON stream proxy
// ---------------------------------------------------------------------------

// GET /access-events/config — return the current access_events config (or defaults).
app.get('/access-events/config', (req, res) => {
    try {
        const model = readModel();
        res.json(model.access_events || defaultAccessEventsConfig());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /access-events/config — validate and persist access_events config.
// Writes to model.access_events and schedules a compile so the MMA YAML is updated.
app.post('/access-events/config', (req, res) => {
    try {
        const body = req.body;
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return res.status(400).json({ error: 'Request body must be an object' });
        }

        // Build config — fixed fields (mode, key_fields, output.type) are always enforced.
        const cfg = {
            enabled: body.enabled === true,
            mode: 'rate',
            window: Number(body.window),
            key_fields: REQUIRED_ACCESS_EVENT_KEY_FIELDS.slice(),
            include_counter: body.include_counter !== false,
            limits: {
                max_keys: Number(body.limits && body.limits.max_keys),
                ttl: Number(body.limits && body.limits.ttl),
            },
            output: {
                type: 'http_stream',
                path: (body.output && typeof body.output.path === 'string') ? body.output.path : '',
                listen: (body.output && typeof body.output.listen === 'string') ? body.output.listen : '',
                host: (body.output && typeof body.output.host === 'string') ? body.output.host.trim() : '',
            },
        };

        const errors = validateAccessEventsConfig(cfg);
        if (errors.length > 0) {
            return res.status(400).json({ error: 'Validation failed', errors });
        }

        const model = readModel();
        model.access_events = cfg;
        writeModel(model);
        scheduleCompile();
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /access-events/stream — proxy the NDJSON event stream from MMA.
// Reads output.listen, output.path, and output.host from model.access_events to
// determine the upstream URL (http://<host>:<port><path>).
app.get('/access-events/stream', (req, res) => {
    try {
        const model = readModel();
        const ae = model.access_events || defaultAccessEventsConfig();

        if (!ae.enabled) {
            return res.status(503).json({ error: 'Access events not enabled — enable in Settings first' });
        }

        const listen = (ae.output && ae.output.listen) || ':9090';
        const evPath = (ae.output && ae.output.path) || '/events';
        const host =
            ae?.output?.host ||
            process.env.TARGET_HOST ||
            'mma';
        const portMatch = listen.match(/:(\d+)$/);
        const port = portMatch ? parseInt(portMatch[1], 10) : 9090;

        res.setHeader('Content-Type', 'application/x-ndjson');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('X-Accel-Buffering', 'no');

        const upstream = http.request(
            { hostname: host, port, path: evPath, method: 'GET' },
            (upstreamRes) => {
                if (upstreamRes.statusCode !== 200) {
                    let body = '';
                    upstreamRes.on('data', (chunk) => { body += chunk; });
                    upstreamRes.on('end', () => {
                        if (!res.headersSent) {
                            res.status(502).json({
                                error: `Access events stream returned HTTP ${upstreamRes.statusCode}`,
                                detail: body.slice(0, 200),
                            });
                        }
                    });
                    return;
                }
                upstreamRes.pipe(res);
            }
        );

        upstream.on('error', (err) => {
            if (!res.headersSent) {
                res.status(502).json({ error: `Cannot connect to access events stream: ${err.message}` });
            } else {
                res.end();
            }
        });

        req.on('close', () => { upstream.destroy(); });
        upstream.end();
    } catch (err) {
        if (!res.headersSent) res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// Device status reading (Modbus TCP → MMA status blocks)
// ---------------------------------------------------------------------------

// GET /devices/status — read status block registers for all devices.
//   Reads are batched per (endpoint, status_unit_id) via modbusService.
app.get('/devices/status', async (req, res) => {
    try {
        const model = readModel();
        const devices = model.devices || [];
        const result = await readDevicesStatus(devices, TARGET_HOST, STATUS_SLOT_SIZE);
        applyStateSealingOverrides(model, result, true);
        res.json({ ok: true, status: result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// Docker runtime control (via Docker socket)
// ---------------------------------------------------------------------------

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
app.get('/runtime/logs/:service', (req, res) => {
    const { service } = req.params;
    if (!ALLOWED_SERVICES.has(service)) {
        return res.status(400).json({ error: `Unknown service "${service}"` });
    }
    streamContainerLogs(service, res, req);
});

// POST /runtime/apply — APPLY layer: compile configs and write to disk (no service restart).
// Blocked if the CHECK layer (computeIntegrity) reports any errors — enforces CHECK → APPLY order.
app.post('/runtime/apply', async (req, res) => {
    try {
        const model = readModel();

        // APPLY gate: only permitted when CHECK passes.
        if (applyIntegrityGate(model, res)) return;

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
        if (applyIntegrityGate(model, res)) return;

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
        const { errors: restartErrors } = await restartServices(['mma', 'replicator']);

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

// POST /test-connection — TCP reachability check (no Modbus payload).
// Body: { endpoint: "host:port" }
// Response: { success: boolean, latency_ms?: number, error?: string }
// Note: protected by requireAuth (app.use(requireAuth) above). Only authenticated
// admins can use this endpoint.  The TCP target is intentionally user-supplied —
// this is an admin diagnostics tool, not a public proxy.
app.post('/test-connection', (req, res) => {
    const { endpoint } = req.body || {};
    if (!endpoint || typeof endpoint !== 'string') {
        return res.status(400).json({ success: false, error: 'endpoint is required' });
    }
    const lastColon = endpoint.lastIndexOf(':');
    if (lastColon < 1) {
        return res.status(400).json({ success: false, error: 'Invalid endpoint format — expected host:port' });
    }
    const host = endpoint.slice(0, lastColon);
    const port = Number(endpoint.slice(lastColon + 1));
    if (!host || !Number.isFinite(port) || port < 1 || port > 65535) {
        return res.status(400).json({ success: false, error: 'Invalid endpoint format — expected host:port' });
    }

    const TIMEOUT_MS = 3000;
    const start = Date.now();
    const socket = new net.Socket();
    let settled = false;

    function finish(success, error) {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (success) {
            res.json({ success: true, latency_ms: Date.now() - start });
        } else {
            res.json({ success: false, error });
        }
    }

    socket.setTimeout(TIMEOUT_MS);
    socket.connect(port, host, () => finish(true, null));
    socket.on('error', (err) => {
        const msg = err.code === 'ECONNREFUSED' ? 'Connection refused'
            : err.code === 'ENOTFOUND'     ? 'DNS resolution failed'
            : err.code === 'ETIMEDOUT'     ? 'Connection timed out'
            : err.message;
        finish(false, msg);
    });
    socket.on('timeout', () => finish(false, 'Connection timed out'));
});

async function pollStateSealingRuntime() {
    if (_stateSealingPollActive) return;
    _stateSealingPollActive = true;
    try {
        const model = readModel();
        const devices = model.devices || [];
        if (devices.length === 0) return;
        const result = await readDevicesStatus(devices, TARGET_HOST, STATUS_SLOT_SIZE);
        applyStateSealingOverrides(model, result, true);
    } catch (err) {
        console.warn(`[state_sealing.poll_error] ${err.message}`);
    } finally {
        _stateSealingPollActive = false;
    }
}

discoverVersion().finally(() => {
    app.listen(8080, () => {
        console.log('Web running on 8080');
    });
    pollStateSealingRuntime();
    setInterval(() => {
        pollStateSealingRuntime();
    }, STATE_SEALING_POLL_INTERVAL_MS);
});
