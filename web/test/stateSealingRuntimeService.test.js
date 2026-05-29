const test = require('node:test');
const assert = require('node:assert/strict');
const { StateSealingRuntime } = require('../src/services/stateSealingRuntimeService');

function status({ health = 1, err = 0, timeouts = 0, transport = 0, fails = 0 } = {}) {
    return {
        health_code: health,
        last_error_code: err,
        timeouts_total: timeouts,
        transport_errors_total: transport,
        consecutive_fail_current: fails,
    };
}

test('offline transition forces override after offline debounce', () => {
    let now = 0;
    const rt = new StateSealingRuntime(() => now);
    const cfg = { enabled: true, forced_state: 'sealed', offline_debounce_ms: 1000, recovery_debounce_ms: 1000 };

    let r = rt.evaluate('d1', status({ health: 0 }), cfg);
    assert.equal(r.overrideActive, false);
    now = 1200;
    r = rt.evaluate('d1', status({ health: 0 }), cfg);
    assert.equal(r.overrideActive, true);
    assert.equal(r.transition, 'forced');
});

test('reconnect recovery clears override after recovery debounce', () => {
    let now = 0;
    const rt = new StateSealingRuntime(() => now);
    const cfg = { enabled: true, forced_state: 'sealed', offline_debounce_ms: 0, recovery_debounce_ms: 1000 };

    let r = rt.evaluate('d1', status({ health: 2 }), cfg);
    assert.equal(r.overrideActive, true);
    now = 100;
    r = rt.evaluate('d1', status({ health: 1 }), cfg);
    assert.equal(r.overrideActive, true);
    now = 1200;
    r = rt.evaluate('d1', status({ health: 1 }), cfg);
    assert.equal(r.overrideActive, false);
    assert.equal(r.transition, 'recovered');
});

test('modbus exception reason code takes precedence', () => {
    const rt = new StateSealingRuntime(() => 0);
    const cfg = { enabled: true, forced_state: 'sealed', offline_debounce_ms: 0, recovery_debounce_ms: 0 };
    const r = rt.evaluate('d1', status({ health: 2, err: 6, timeouts: 9 }), cfg);
    assert.equal(r.reasonCode, 'modbus_exception');
});

test('timeout reason code when unhealthy with no modbus code', () => {
    const rt = new StateSealingRuntime(() => 0);
    const cfg = { enabled: true, forced_state: 'sealed', offline_debounce_ms: 0, recovery_debounce_ms: 0 };
    const r = rt.evaluate('d1', status({ health: 0, timeouts: 1 }), cfg);
    assert.equal(r.reasonCode, 'timeout');
});

test('reconnect flapping does not clear override before debounce', () => {
    let now = 0;
    const rt = new StateSealingRuntime(() => now);
    const cfg = { enabled: true, forced_state: 'sealed', offline_debounce_ms: 0, recovery_debounce_ms: 1000 };

    rt.evaluate('d1', status({ health: 2 }), cfg); // force immediately
    now = 500;
    let r = rt.evaluate('d1', status({ health: 1 }), cfg); // start recovery timer
    assert.equal(r.overrideActive, true);
    now = 700;
    r = rt.evaluate('d1', status({ health: 2 }), cfg); // flap back unhealthy
    assert.equal(r.overrideActive, true);
    now = 1300;
    r = rt.evaluate('d1', status({ health: 1 }), cfg); // recovery timer restarts
    assert.equal(r.overrideActive, true);
});

test('override precedence exports forced state over live state', () => {
    const rt = new StateSealingRuntime(() => 0);
    const cfg = { enabled: true, forced_state: 'unsealed', offline_debounce_ms: 0, recovery_debounce_ms: 0 };
    const r = rt.evaluate('d1', status({ health: 2 }), cfg);
    assert.equal(r.overrideActive, true);
    assert.equal(r.effectiveState, 'unsealed');
});

test('debounce behavior delays force activation', () => {
    let now = 0;
    const rt = new StateSealingRuntime(() => now);
    const cfg = { enabled: true, forced_state: 'sealed', offline_debounce_ms: 2000, recovery_debounce_ms: 0 };

    let r = rt.evaluate('d1', status({ health: 2 }), cfg);
    assert.equal(r.overrideActive, false);
    now = 1999;
    r = rt.evaluate('d1', status({ health: 2 }), cfg);
    assert.equal(r.overrideActive, false);
    now = 2000;
    r = rt.evaluate('d1', status({ health: 2 }), cfg);
    assert.equal(r.overrideActive, true);
});
