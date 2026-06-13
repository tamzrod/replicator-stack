'use strict';

// ---------------------------------------------------------------------------
// yamlCompiler.js — pure YAML generation + validation functions.
// No side effects, no I/O, no Express dependencies.
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


// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

// Maps Modbus area names to function codes (per Modbus protocol spec).
const AREA_TO_FC = {
    holding_registers: 3,
    coils: 1,
    input_registers: 4,
    discrete_inputs: 2,
    input_status: 2,
};

// All valid Modbus function codes across all area types.
// "Allow-all" always includes every FC — MMA enforces area-specific validity at runtime.
const ALL_VALID_FCS = [1, 2, 3, 4, 5, 6, 15, 16];

function getControlCoilAddress(model, device) {
    const targetPort = endpointPort(device && device.target_endpoint);
    const unitId = Number(device && device.unitId);
    if (!Number.isFinite(targetPort) || !Number.isFinite(unitId)) return 0;

    const memoryPorts = (model && model.memory && model.memory.ports) || [];
    const port = memoryPorts.find(p => Number(p.port) === targetPort);
    if (!port) return 0;
    const unit = (port.units || []).find(u => Number(u.unit_id) === unitId);
    if (!unit) return 0;

    const coilSegments = (unit.areas || [])
        .filter(a => a && a.type === 'coils')
        .flatMap(a => Array.isArray(a.segments) ? a.segments : [])
        .map(seg => ({ start: Number(seg.start), count: Number(seg.count) }))
        .filter(seg => Number.isFinite(seg.start) && Number.isFinite(seg.count) && seg.count > 0);

    if (coilSegments.length === 0) return 0;
    const maxEndExclusive = Math.max(...coilSegments.map(seg => seg.start + seg.count));
    return Math.max(0, maxEndExclusive);
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

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
            // invert / addinvert are only valid for FC1 (coils) and FC2 (discrete inputs)
            if (fc === 1 || fc === 2) {
                if (read.invert)    lines.push(`          invert: true`);
                if (read.addinvert) lines.push(`          addinvert: true`);
            }
        }
        lines.push(`      targets:`);
        lines.push(`        - id: ${device.unitId}`);
        lines.push(`          endpoint: "${targetEndpoint}"`);
        lines.push(`          unit_id: ${device.unitId}`);
        if (device.status_unit_id != null) {
            lines.push(`          status_unit_id: ${Number(device.status_unit_id)}`);
        }
        if (device.health_controlled_state_sealing) {
            const controlCoilAddress = getControlCoilAddress(model, device);
            lines.push(`          health_control:`);
            lines.push(`            enabled: true`);
            lines.push(`            area: coil`);
            lines.push(`            address: ${controlCoilAddress}`);
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
 * Return the full allow-all function code list: all 8 valid Modbus FCs.
 * "Allow-all" is always [1,2,3,4,5,6,15,16] regardless of which area types
 * are present — MMA enforces per-area validity at runtime.
 *
 * @returns {number[]}
 */
function allowAllFcs() {
    return ALL_VALID_FCS.slice();
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
    // byUnitId: unit_id → { unitId, isStatus, domains: Map<area, segments[]>, sourceCount }
    const byUnitId = new Map();
    const mergeLog = [];

    function addSegments(uid, area, segments, isStatus) {
        if (!byUnitId.has(uid)) {
            byUnitId.set(uid, { unitId: uid, isStatus: false, domains: new Map(), sourceCount: 0 });
        }
        const entry = byUnitId.get(uid);
        entry.sourceCount += 1;
        if (isStatus) entry.isStatus = true;

        if (!entry.domains.has(area)) {
            entry.domains.set(area, []);
        }
        // Accumulate segments — never auto-merge.
        entry.domains.get(area).push(...segments);
    }

    // Process regular device-read blocks (each block is one segment).
    for (const block of blocks) {
        addSegments(
            Number(block.unit_id),
            block.area || 'holding_registers',
            [{ start: block.address, count: block.count }],
            false
        );
    }

    // Process status memory entries (derived from devices with status_unit_id).
    for (const [suid, deviceCount] of statusMap) {
        addSegments(suid, 'holding_registers', [{ start: 0, count: deviceCount * STATUS_SLOT_SIZE }], true);
    }

    // Build merge log entries for unit_ids that had more than one source block.
    for (const entry of byUnitId.values()) {
        if (entry.sourceCount > 1) {
            mergeLog.push({
                unit_id:             entry.unitId,
                action:              'segments_accumulated',
                sourceEntriesMerged: entry.sourceCount,
                fieldsCombined:      [...entry.domains.keys()],
                rulesDeduped:        0,
            });
        }
    }

    // Return units sorted by unit_id for deterministic output.
    const mergedUnits = [...byUnitId.values()].sort((a, b) => a.unitId - b.unitId);
    return { mergedUnits, mergeLog };
}

/**
 * Build the YAML lines for the access_events top-level block.
 * Key fields are always the required six from the MMA2 manual, in canonical order.
 * @param {object} ae - model.access_events object
 * @returns {string[]}
 */
function _buildAccessEventsYamlLines(ae) {
    return [
        'access_events:',
        `  enabled: ${ae.enabled ? 'true' : 'false'}`,
        `  mode: rate`,
        `  window: ${Number(ae.window) || 5}`,
        `  key_fields:`,
        `    - src_ip`,
        `    - function_code`,
        `    - action`,
        `    - status`,
        `    - port`,
        `    - unit`,
        `  include_counter: ${ae.include_counter ? 'true' : 'false'}`,
        `  limits:`,
        `    max_keys: ${Number((ae.limits && ae.limits.max_keys)) || 1000}`,
        `    ttl: ${Number((ae.limits && ae.limits.ttl)) || 30}`,
        `  output:`,
        `    type: http_stream`,
        `    path: ${(ae.output && ae.output.path) || '/events'}`,
        `    listen: "${(ae.output && ae.output.listen) || ':9090'}"`,
    ];
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
        const lines = ['listeners: []'];
        const ae = model.access_events;
        if (ae && typeof ae === 'object') {
            lines.push('');
            lines.push(..._buildAccessEventsYamlLines(ae));
        }
        return { yaml: lines.join('\n') + '\n', mergeLog: [] };
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
        const healthControlByUnitId = {};
        for (const device of (model.devices || [])) {
            if (!device.health_controlled_state_sealing) continue;
            if (endpointPort(device.target_endpoint) !== portNum) continue;
            const unitId = Number(device.unitId);
            if (!Number.isFinite(unitId)) continue;
            healthControlByUnitId[unitId] = getControlCoilAddress(model, device);
        }
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
            // Flatten units[] → blocks format for compileMma2Config.
            // Each area's segments become individual blocks (one per segment).
            blocksForCompile = (port.units || []).flatMap(u => {
                if (u.state_sealing && !(u.unit_id in stateSealingByUnitId)) {
                    stateSealingByUnitId[u.unit_id] = u.state_sealing;
                }
                if (u.policy && !(u.unit_id in policyByUnitId)) {
                    policyByUnitId[u.unit_id] = u.policy;
                }
                return (u.areas || []).flatMap(a => {
                    const segs = Array.isArray(a.segments) ? a.segments : [];
                    return segs.map(seg => ({
                        unit_id: u.unit_id,
                        area: a.type || 'holding_registers',
                        address: seg.start,
                        count: seg.count,
                    }));
                });
            });
        } else {
            // Fall back to auto-derived blocks from device reads
            blocksForCompile = port.blocks || [];
        }
        for (const [unitId, address] of Object.entries(healthControlByUnitId)) {
            stateSealingByUnitId[unitId] = { enabled: true, area: 'coil', address: Math.max(0, Number(address) || 0) };
        }

        // Run the MMA2 compiler: group all segments for this port.
        const { mergedUnits, mergeLog } = compileMma2Config(blocksForCompile, statusMap);
        for (const entry of mergeLog) {
            allMergeLog.push({ listener: listenerId, port: portNum, ...entry });
        }

        if (mergedUnits.length === 0) {
            lines.push(`      []`);
        } else {
            for (const unit of mergedUnits) {
                lines.push(`      - unit_id: ${unit.unitId}`);
                const healthControlAddress = healthControlByUnitId[unit.unitId];
                const safeHealthControlAddress = Number.isFinite(healthControlAddress)
                    ? Math.max(0, healthControlAddress)
                    : null;
                let emittedCoils = false;

                // Emit each domain section as a scalar range (MMA2 v2.3.4 schema).
                // MMA2 accepts one contiguous start/count range per area — not a list.
                // When multiple segments exist, span them into the widest contiguous range.
                for (const [area, segments] of unit.domains) {
                    let start = Math.min(...segments.map(s => s.start));
                    let end   = Math.max(...segments.map(s => s.start + s.count));
                    if (area === 'coils') {
                        emittedCoils = true;
                        if (safeHealthControlAddress !== null) {
                            start = Math.min(start, safeHealthControlAddress);
                            end = Math.max(end, safeHealthControlAddress + 1);
                        }
                    }
                    lines.push(`        ${area}:`);
                    lines.push(`          start: ${start}`);
                    lines.push(`          count: ${end - start}`);
                }
                if (!emittedCoils && safeHealthControlAddress !== null) {
                    lines.push(`        coils:`);
                    lines.push(`          start: 0`);
                    lines.push(`          count: ${safeHealthControlAddress + 1}`);
                }

                // Emit state_sealing if configured on this unit.
                const ss = stateSealingByUnitId[unit.unitId];
                if (ss && ss.area === 'coil') {
                    lines.push(`        state_sealing:`);
                    lines.push(`          enabled: true`);
                    lines.push(`          area: coil`);
                    lines.push(`          address: ${ss.address}`);
                }

                // Emit policy.  When user has configured a custom policy, use it.
                // Otherwise emit the explicit allow-all default: all 8 valid Modbus FCs
                // from any source IP.  MMA enforces per-area FC validity at runtime.
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
                    const fcs = allowAllFcs();
                    lines.push(`        policy:`);
                    lines.push(`          rules:`);
                    lines.push(`            - id: allow-all`);
                    lines.push(`              source_ip:`);
                    lines.push(`                - 0.0.0.0/0`);
                    lines.push(`                - ::/0`);
                    lines.push(`              allow_fc: [${fcs.join(', ')}]`);
                }
            }
        }
    }
    // Append access_events block if configured in the model.
    const ae = model.access_events;
    if (ae && typeof ae === 'object') {
        lines.push('');
        lines.push(..._buildAccessEventsYamlLines(ae));
    }

    return { yaml: lines.join('\n') + '\n', mergeLog: allMergeLog };
}

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

    // Reject any use of the deprecated `segments:` wrapper key or YAML sequence lists
    // under area keys.  MMA2 v2.3.4 requires a scalar start/count pair per area:
    //   holding_registers:
    //     start: 0
    //     count: 10
    if (/^\s+segments\s*:/m.test(yaml)) {
        errors.push('MMA config must not use segments: wrapper — each area must use scalar start/count fields (e.g. holding_registers: start: 0 count: 10)');
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

module.exports = {
    toReplicatorYaml,
    toMmaYaml,
    compileMma2Config,
    validateMmaConfig,
    validateReplicatorConfig,
};
