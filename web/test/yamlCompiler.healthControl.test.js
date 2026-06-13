const test = require('node:test');
const assert = require('node:assert/strict');
const { toReplicatorYaml, toMmaYaml } = require('../src/services/yamlCompiler');

function makeBaseModel(unit) {
    return {
        devices: [
            {
                id: 'dev-1',
                name: 'dev-1',
                source_endpoint: '10.0.0.1:502',
                source_unit_id: 1,
                target_endpoint: 'mma:502',
                unitId: 1,
                status_slot: 0,
                status_unit_id: 100,
                health_controlled_state_sealing: true,
                reads: [{ source_area: 'holding_registers', source_address: 0, source_count: 10, poll_interval: 1000 }],
            },
        ],
        memory: {
            ports: [{ id: 'p1', port: 502, blocks: [], units: [unit] }],
        },
    };
}

test('health-controlled state sealing extends existing coils and shares same address with health_control', () => {
    const model = makeBaseModel({
        id: 'u1',
        unit_id: 1,
        areas: [
            { id: 'a1', type: 'coils', segments: [{ start: 0, count: 100 }] },
            { id: 'a2', type: 'holding_registers', segments: [{ start: 0, count: 500 }] },
        ],
    });

    const replicatorYaml = toReplicatorYaml(model);
    const { yaml: mmaYaml } = toMmaYaml(model);

    assert.match(replicatorYaml, /health_control:\n\s+enabled: true\n\s+area: coil\n\s+address: 100/);
    assert.match(mmaYaml, /coils:\n\s+start: 0\n\s+count: 101/);
    assert.match(mmaYaml, /state_sealing:\n\s+enabled: true\n\s+area: coil\n\s+address: 100/);
});

test('health-controlled state sealing allocates coil 0 when no coils exist', () => {
    const model = makeBaseModel({
        id: 'u1',
        unit_id: 1,
        areas: [{ id: 'a1', type: 'holding_registers', segments: [{ start: 0, count: 500 }] }],
    });

    const replicatorYaml = toReplicatorYaml(model);
    const { yaml: mmaYaml } = toMmaYaml(model);

    assert.match(replicatorYaml, /health_control:\n\s+enabled: true\n\s+area: coil\n\s+address: 0/);
    assert.match(mmaYaml, /coils:\n\s+start: 0\n\s+count: 1/);
    assert.match(mmaYaml, /state_sealing:\n\s+enabled: true\n\s+area: coil\n\s+address: 0/);
});
