'use strict';

// ---------------------------------------------------------------------------
// integrityService.js — pure integrity CHECK layer (read-only, no side effects).
// No I/O, no Express dependencies.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Private helpers (copies of shared utilities from index.js)
// ---------------------------------------------------------------------------

// Number of holding registers consumed by each device's status slot.
const STATUS_SLOT_SIZE = 30;

// Extract the port number from an endpoint string. Returns null on failure.
function endpointPort(endpoint) {
    if (typeof endpoint !== 'string') return null;
    const lastColon = endpoint.lastIndexOf(':');
    if (lastColon < 0) return null;
    const port = Number(endpoint.slice(lastColon + 1));
    return Number.isFinite(port) && port >= 1 && port <= 65535 ? port : null;
}

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

// ---------------------------------------------------------------------------
// Exported function
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
        // epStatusUidMap only contains endpoints with at least one assigned suid,
        // so counts.size >= 1 here — the null fallback is never reached.
        epCanonicalUid.set(epKey, pickCanonicalSuid(counts, null));
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
            deviceIssues.push({ code: 'UNASSIGNED_STATUS_UNIT_ID', severity: 'error', message: 'UNASSIGNED_STATUS_UNIT_ID — status_unit_id not assigned; run Fix Issues or trigger a compile to repair' });
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

        // CHECK: device must have at least one read definition — required for valid YAML.
        const reads = device.reads || [];
        const includedInYaml = reads.length > 0;
        if (!includedInYaml) {
            deviceIssues.push({
                type: 'validation_error',
                target: 'device',
                device_id: device.id,
                code: 'NO_READS',
                severity: 'error',
                message: 'Device must have at least one read definition',
            });
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

module.exports = { computeIntegrity };
