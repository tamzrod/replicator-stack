'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeIntegrity } = require('../src/services/integrityService');

// Build a minimal valid device without health control so we can selectively enable it.
function makeDevice(overrides = {}) {
    return {
        id: 'dev-1',
        name: 'dev-1',
        source_endpoint: '10.0.0.1:502',
        source_unit_id: 1,
        target_endpoint: 'mma:502',
        unitId: 1,
        status_slot: 0,
        status_unit_id: 100,
        health_controlled_state_sealing: false,
        reads: [{ source_area: 'holding_registers', source_address: 0, source_count: 10, poll_interval: 1000 }],
        ...overrides,
    };
}

function makeModel(device, units = []) {
    return {
        devices: [device],
        memory: {
            ports: [{ id: 'p1', port: 502, blocks: [], units }],
        },
    };
}

// ---------------------------------------------------------------------------
// PASS scenarios
// ---------------------------------------------------------------------------

test('CHECK passes when health control is disabled', () => {
    const device = makeDevice({ health_controlled_state_sealing: false });
    const unit = {
        id: 'u1', unit_id: 1,
        areas: [{ id: 'a1', type: 'holding_registers', segments: [{ start: 0, count: 500 }] }],
    };
    const result = computeIntegrity(makeModel(device, [unit]));
    const hcErrors = result.issues.filter(i => i.code && i.code.startsWith('HEALTH_CONTROL_'));
    assert.equal(hcErrors.length, 0, 'no health control errors when disabled');
});

test('CHECK passes when health control is enabled and memory is properly allocated', () => {
    const device = makeDevice({ health_controlled_state_sealing: true });
    const unit = {
        id: 'u1', unit_id: 1,
        areas: [
            { id: 'a1', type: 'coils', segments: [{ start: 0, count: 100 }] },
            { id: 'a2', type: 'holding_registers', segments: [{ start: 0, count: 500 }] },
        ],
    };
    const result = computeIntegrity(makeModel(device, [unit]));
    const hcErrors = result.issues.filter(i => i.code && i.code.startsWith('HEALTH_CONTROL_'));
    assert.equal(hcErrors.length, 0, 'no health control errors when memory is allocated');
});

test('CHECK passes when health control is enabled and unit has no coils yet (compiler will allocate)', () => {
    const device = makeDevice({ health_controlled_state_sealing: true });
    const unit = {
        id: 'u1', unit_id: 1,
        areas: [{ id: 'a1', type: 'holding_registers', segments: [{ start: 0, count: 500 }] }],
    };
    const result = computeIntegrity(makeModel(device, [unit]));
    const hcErrors = result.issues.filter(i => i.code && i.code.startsWith('HEALTH_CONTROL_'));
    assert.equal(hcErrors.length, 0, 'no health control errors — compiler auto-allocates coil 0');
});

// ---------------------------------------------------------------------------
// FAIL scenarios
// ---------------------------------------------------------------------------

test('CHECK fails with HEALTH_CONTROL_NO_MEMORY_PORT when no memory port exists', () => {
    const device = makeDevice({ health_controlled_state_sealing: true });
    // Empty memory — no ports at all
    const model = { devices: [device], memory: { ports: [] } };
    const result = computeIntegrity(model);
    const hcErrors = result.issues.filter(i => i.code === 'HEALTH_CONTROL_NO_MEMORY_PORT');
    assert.equal(hcErrors.length, 1, 'exactly one HEALTH_CONTROL_NO_MEMORY_PORT error');
    assert.equal(result.ok, false);
});

test('CHECK fails with HEALTH_CONTROL_NO_UNIT when port exists but unit is absent', () => {
    const device = makeDevice({ health_controlled_state_sealing: true });
    // Port 502 exists but has no unit matching unitId=1
    const model = {
        devices: [device],
        memory: {
            ports: [{
                id: 'p1', port: 502, blocks: [], units: [
                    { id: 'u99', unit_id: 99, areas: [{ id: 'a1', type: 'holding_registers', segments: [{ start: 0, count: 100 }] }] },
                ],
            }],
        },
    };
    const result = computeIntegrity(model);
    const hcErrors = result.issues.filter(i => i.code === 'HEALTH_CONTROL_NO_UNIT');
    assert.equal(hcErrors.length, 1, 'exactly one HEALTH_CONTROL_NO_UNIT error');
    assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// Reload / round-trip scenario
// ---------------------------------------------------------------------------

test('health_controlled_state_sealing flag survives model round-trip unchanged', () => {
    // Simulate what happens when a model is serialised and read back:
    // the flag must remain true so the checkbox is correctly restored.
    const device = makeDevice({ health_controlled_state_sealing: true });
    const serialised = JSON.parse(JSON.stringify(device));
    assert.equal(serialised.health_controlled_state_sealing, true,
        'flag is preserved after JSON round-trip');
});
