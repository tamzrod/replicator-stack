'use strict';

const DEFAULT_STATE_SEALING_OVERRIDE = Object.freeze({
    enabled: false,
    forced_state: 'sealed',
    offline_debounce_ms: 1000,
    recovery_debounce_ms: 3000,
});

function clampDebounceMs(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.min(60000, Math.floor(n));
}

function normalizeForcedState(value) {
    if (value === 'unsealed' || value === 'unlocked') return 'unsealed';
    return 'sealed';
}

function normalizeStateSealingOverrideConfig(raw) {
    const cfg = (raw && typeof raw === 'object') ? raw : {};
    return {
        enabled: !!cfg.enabled,
        forced_state: normalizeForcedState(cfg.forced_state),
        offline_debounce_ms: clampDebounceMs(cfg.offline_debounce_ms, DEFAULT_STATE_SEALING_OVERRIDE.offline_debounce_ms),
        recovery_debounce_ms: clampDebounceMs(cfg.recovery_debounce_ms, DEFAULT_STATE_SEALING_OVERRIDE.recovery_debounce_ms),
    };
}

function reasonCodeForStatus(status) {
    const s = status || {};
    const health = Number(s.health_code) || 0;
    const err = Number(s.last_error_code) || 0;
    const timeouts = Number(s.timeouts_total) || 0;
    const transportErrors = Number(s.transport_errors_total) || 0;
    const consecFail = Number(s.consecutive_fail_current) || 0;

    if (err > 0) return 'modbus_exception';
    if (timeouts > 0) return 'timeout';
    if (transportErrors > 0) return 'transport_disconnect';
    if (consecFail > 0) return 'polling_failure';
    if (health === 0 || health === 3 || health === 4) return 'offline';
    if (health === 2) return 'runtime_error';
    return 'runtime_error';
}

function isUnhealthyStatus(status) {
    const health = Number(status && status.health_code) || 0;
    return health !== 1;
}

class StateSealingRuntime {
    constructor(nowFn = Date.now) {
        this._now = nowFn;
        this._device = new Map();
    }

    _stateFor(id) {
        if (!this._device.has(id)) {
            this._device.set(id, {
                overrideActive: false,
                unhealthySince: null,
                healthySince: null,
                reasonCode: null,
            });
        }
        return this._device.get(id);
    }

    evaluate(deviceId, status, config) {
        const cfg = normalizeStateSealingOverrideConfig(config);
        const state = this._stateFor(deviceId);
        const now = this._now();
        const unhealthy = isUnhealthyStatus(status);
        let transition = null;

        if (!cfg.enabled) {
            if (state.overrideActive) transition = 'recovered';
            state.overrideActive = false;
            state.unhealthySince = null;
            state.healthySince = null;
            state.reasonCode = null;
            return {
                transition,
                reasonCode: null,
                overrideActive: false,
                effectiveState: 'live',
                forcedState: cfg.forced_state,
            };
        }

        if (unhealthy) {
            state.healthySince = null;
            if (state.unhealthySince == null) state.unhealthySince = now;
            const elapsed = now - state.unhealthySince;
            if (!state.overrideActive && elapsed >= cfg.offline_debounce_ms) {
                state.overrideActive = true;
                state.reasonCode = reasonCodeForStatus(status);
                transition = 'forced';
            }
        } else {
            state.unhealthySince = null;
            if (state.healthySince == null) state.healthySince = now;
            const elapsed = now - state.healthySince;
            if (state.overrideActive && elapsed >= cfg.recovery_debounce_ms) {
                state.overrideActive = false;
                state.reasonCode = null;
                transition = 'recovered';
            }
        }

        return {
            transition,
            reasonCode: state.overrideActive ? state.reasonCode : null,
            overrideActive: state.overrideActive,
            effectiveState: state.overrideActive ? cfg.forced_state : 'live',
            forcedState: cfg.forced_state,
        };
    }
}

module.exports = {
    DEFAULT_STATE_SEALING_OVERRIDE,
    normalizeStateSealingOverrideConfig,
    StateSealingRuntime,
};
