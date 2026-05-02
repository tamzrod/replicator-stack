'use strict';

const { randomUUID, createHash } = require('crypto');

const {
    toReplicatorYaml,
    toMmaYaml,
    validateMmaConfig,
    validateReplicatorConfig,
} = require('./yamlCompiler');

const {
    _idx,
    readModel,
    writeModel,
    atomicWrite,
    invalidateCache,
    bumpCanonicalVersion,
    setYamlHash,
    REPLICATOR_CONFIG_PATH,
    MMA_CONFIG_PATH,
    DEFAULT_STATUS_UNIT_ID,
    endpointPort,
    getMissingTargetPorts,
    recompileStatusSlots,
    pickCanonicalSuid,
} = require('./modelStore');

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

/**
 * Flush any pending debounced compile immediately.
 * Used by GET /model/snapshot so the snapshot always returns YAML that matches
 * the current model, even when called immediately after a mutation.
 */
function flushPendingCompile() {
    if (!_compilePending) return;
    if (_compileTimer) {
        clearTimeout(_compileTimer);
        _compileTimer = null;
    }
    _compilePending = false;
    autoCompile(readModel());
}

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

        // One block per distinct read range — no merging, gaps are preserved.
        for (const range of req.ranges) {
            port.blocks.push({
                id: randomUUID(),
                unit_id: req.unitId,
                area: req.area,
                address: range.start,
                count: range.end - range.start + 1,
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

    // Step 4: ensure every device has a non-null status_unit_id.
    // Devices on the same target_endpoint must share the same value.
    // Any device that still has null is assigned the endpoint group's canonical
    // value, falling back to DEFAULT_STATUS_UNIT_ID when the whole group is unset.
    let statusUidsModified = false;
    const epStatusCounts = new Map(); // epKey → Map<suid, count>
    for (const device of (model.devices || [])) {
        if (device.status_unit_id == null) continue;
        const epKey = (device.target_endpoint || '').trim().toLowerCase();
        if (!epStatusCounts.has(epKey)) epStatusCounts.set(epKey, new Map());
        const suid = Number(device.status_unit_id);
        const m = epStatusCounts.get(epKey);
        m.set(suid, (m.get(suid) || 0) + 1);
    }
    for (const device of (model.devices || [])) {
        if (device.status_unit_id != null) continue;
        const epKey = (device.target_endpoint || '').trim().toLowerCase();
        const counts = epStatusCounts.get(epKey) || new Map();
        const canonical = pickCanonicalSuid(counts, DEFAULT_STATUS_UNIT_ID);
        device.status_unit_id = canonical;
        // Register the assigned value so subsequent null devices on the same
        // endpoint get the same canonical rather than each defaulting independently.
        if (!epStatusCounts.has(epKey)) epStatusCounts.set(epKey, new Map());
        const m = epStatusCounts.get(epKey);
        m.set(canonical, (m.get(canonical) || 0) + 1);
        statusUidsModified = true;
    }

    const modified = blocksChanged || statusSlots.modified || statusUidsModified;
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
        // Discard in-memory mutations (rehydration, conflict resolution) without
        // persisting them — model.json and YAML remain at their last good state.
        invalidateCache();
        return { ok: false, mmaErrors: [conflictError], replicatorErrors: [], resolutionLog: [] };
    }

    // NOTE: writeModel() is intentionally NOT called here.
    // model.json is only written alongside the YAML files (below) so that the two
    // stores are always atomically consistent.  Any in-memory mutations made by
    // rehydrateFromYaml / resolveIdentityConflicts that do not survive a failed
    // validation are discarded by resetting _modelCache (see failure paths below).

    if (!skipValidation) {
        // Validate no duplicate unit_id within the same port (listener).
        // NOTE: per MMA2 semantics, duplicate unit_id entries are MERGED by
        // compileMma2Config (unit_id is a container ID, not a unique block ID).
        // This check has been intentionally removed — duplicates produce a merged
        // unit in the output, not an error.
    }

    // Validate that every device has at least one read definition.
    // This check is ALWAYS enforced — skipValidation does not bypass it.
    // A device with no reads cannot produce valid YAML and is always an invalid state.
    const devicesWithNoReads = (model.devices || []).filter(d => !(d.reads && d.reads.length > 0));
    if (devicesWithNoReads.length > 0) {
        invalidateCache();
        const validationErrors = devicesWithNoReads.map(d => ({
            type: 'validation_error',
            target: 'device',
            device_id: d.id,
            message: 'Device must have at least one read definition',
        }));
        return {
            ok: false,
            mmaErrors: [],
            replicatorErrors: devicesWithNoReads.map(d => `Device "${d.name || d.id}" must have at least one read definition`),
            validationErrors,
            resolutionLog,
        };
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
        // Discard in-memory mutations without persisting them.
        invalidateCache();
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
            // Discard in-memory mutations without persisting them.
            invalidateCache();
            return { ok: false, mmaErrors, replicatorErrors, resolutionLog, mergeLog };
        }
    }

    // All validation passed — write model.json and YAML together so the two
    // stores are always co-committed.  model.json is written here (not earlier)
    // to guarantee it is never ahead of or behind the YAML files on disk.
    if (rehydrated.modified || resolutionLog.length > 0) {
        // Persist rehydration mutations (blocks, status slots, status_unit_ids)
        // and any conflict-resolution remappings alongside the YAML write.
        writeModel(model);
    }
    atomicWrite(REPLICATOR_CONFIG_PATH, replicatorYaml);
    atomicWrite(MMA_CONFIG_PATH, mmaYaml);
    // Compute a content hash of the written YAML pair so the UI can detect
    // filesystem drift between saves (e.g. external edits or a second client).
    // Each file is hashed independently and the two digests are concatenated so
    // swapping file order or re-combining them differently does not produce a
    // false-negative collision.
    const replicatorHash = createHash('sha256').update(replicatorYaml).digest('hex');
    const mmaHash        = createHash('sha256').update(mmaYaml).digest('hex');
    setYamlHash(`${replicatorHash}:${mmaHash}`);
    // Advance the canonical version stamp — every successful YAML write moves
    // the authoritative state forward by exactly one step.
    bumpCanonicalVersion();
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

module.exports = {
    scheduleCompile,
    flushPendingCompile,
    autoCompile,
    mergeRanges,
    rehydrateFromYaml,
    resolveIdentityConflicts,
    autoFixDuplicateUnitIds,
    buildErrorSummary,
    compileAndWrite,
};
