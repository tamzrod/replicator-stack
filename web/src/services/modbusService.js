'use strict';

const net = require('net');

/**
 * Read holding registers from a Modbus TCP endpoint.
 * Uses the built-in `net` module — no extra dependencies.
 * Returns an array of uint16 register values, or null on any error/timeout.
 *
 * @param {string} host
 * @param {number} port
 * @param {number} unitId   - Modbus unit ID
 * @param {number} startAddr - First register address (0-based)
 * @param {number} count     - Number of registers to read
 * @param {number} [timeoutMs=2000]
 * @returns {Promise<number[]|null>}
 */
function modbusReadHoldingRegisters(host, port, unitId, startAddr, count, timeoutMs) {
    timeoutMs = timeoutMs || 2000;
    return new Promise(resolve => {
        let settled = false;
        const done = val => { if (!settled) { settled = true; resolve(val); } };

        const socket = net.createConnection({ host, port: Number(port) });
        const timer = setTimeout(() => { socket.destroy(); done(null); }, timeoutMs);

        // Modbus TCP request (MBAP header + PDU)
        const req = Buffer.alloc(12);
        req.writeUInt16BE(1, 0);          // Transaction ID
        req.writeUInt16BE(0, 2);          // Protocol ID
        req.writeUInt16BE(6, 4);          // Length (bytes that follow)
        req.writeUInt8(unitId & 0xFF, 6); // Unit ID
        req.writeUInt8(3, 7);             // FC 03: Read Holding Registers
        req.writeUInt16BE(startAddr, 8);
        req.writeUInt16BE(count, 10);

        const chunks = [];
        socket.on('connect', () => socket.write(req));
        socket.on('data', chunk => {
            chunks.push(chunk);
            const data = Buffer.concat(chunks);
            // Wait for at least MBAP header (7 bytes) + FC byte + byte-count byte
            if (data.length < 9) return;
            const byteCount = data[8];
            if (data.length < 9 + byteCount) return;
            clearTimeout(timer);
            socket.destroy();
            // Validate FC and byte count
            if (data[7] !== 3 || byteCount !== count * 2) { done(null); return; }
            const regs = [];
            for (let i = 0; i < count; i++) {
                regs.push(data.readUInt16BE(9 + i * 2));
            }
            done(regs);
        });
        socket.on('error', () => { clearTimeout(timer); socket.destroy(); done(null); });
        socket.on('close', () => { clearTimeout(timer); done(null); });
    });
}

/**
 * Read status registers for all devices, batched by (host, port, status_unit_id).
 *
 * @param {object[]} devices        - Array of device objects from the model
 * @param {string}   targetHost     - Fallback host when device has no target_endpoint
 * @param {number}   statusSlotSize - Number of holding registers per status slot
 * @returns {Promise<object>}       - Map of deviceId → status fields
 */
async function readDevicesStatus(devices, targetHost, statusSlotSize) {
    const result = {};

    // Group devices by (host, port, status_unit_id) so we can batch-read.
    const groupMap = new Map();
    for (const device of devices) {
        if (device.status_unit_id == null) continue;
        const ep = device.target_endpoint || `${targetHost}:502`;
        const lastColon = ep.lastIndexOf(':');
        const host = lastColon > 0 ? ep.slice(0, lastColon) : ep;
        const port = lastColon > 0 ? parseInt(ep.slice(lastColon + 1), 10) : 502;
        const key = `${host}\x00${port}\x00${device.status_unit_id}`;
        if (!groupMap.has(key)) {
            groupMap.set(key, { host, port, unitId: Number(device.status_unit_id), devices: [] });
        }
        groupMap.get(key).devices.push(device);
    }

    await Promise.all([...groupMap.values()].map(async ({ host, port, unitId, devices: grpDevs }) => {
        const maxSlot = Math.max(...grpDevs.map(d => Number(d.status_slot) || 0));
        // Read all registers of every slot up to and including the last device's slot.
        const readCount = (maxSlot + 1) * statusSlotSize;
        const regs = await modbusReadHoldingRegisters(host, port, unitId, 0, readCount);

        for (const device of grpDevs) {
            const base = (Number(device.status_slot) || 0) * statusSlotSize;
            // Helper: read one register at slot-relative offset (called only inside the
            // `if (regs && regs.length > base)` guard, so regs is guaranteed non-null here).
            const get = (off) => (regs.length > base + off) ? (regs[base + off] || 0) : 0;
            // Helper: read uint32 (lo word at loOff, hi word at loOff+1).
            const get32 = (loOff) => get(loOff) + get(loOff + 1) * 65536;

            let health_code = 0;
            let last_error_code = 0;
            let seconds_in_error = 0;
            let device_name = '';
            let requests_total = 0;
            let responses_valid_total = 0;
            let timeouts_total = 0;
            let transport_errors_total = 0;
            let consecutive_fail_current = 0;
            let consecutive_fail_max = 0;

            if (regs && regs.length > base) {
                // Slots 0–2: operational truth
                health_code      = get(0);
                last_error_code  = get(1);
                seconds_in_error = get(2);

                // Slots 3–10: device_name (ASCII, max 16 chars, 8 registers × 2 bytes)
                const nameStart = base + 3;
                const nameEnd   = Math.min(base + 11, regs.length);
                if (nameEnd > nameStart) {
                    const nameRegs  = regs.slice(nameStart, nameEnd);
                    const nameBytes = Buffer.alloc(nameRegs.length * 2);
                    for (let i = 0; i < nameRegs.length; i++) {
                        nameBytes.writeUInt16BE(nameRegs[i] || 0, i * 2);
                    }
                    device_name = nameBytes.toString('ascii').replace(/\0.*/, '').trim();
                }

                // Slots 20–29: transport lifetime counters
                if (regs.length >= base + statusSlotSize) {
                    requests_total           = get32(20);
                    responses_valid_total    = get32(22);
                    timeouts_total           = get32(24);
                    transport_errors_total   = get32(26);
                    consecutive_fail_current = get(28);
                    consecutive_fail_max     = get(29);
                }
            }

            const online    = !!(regs && regs.length > base && health_code === 1);
            const last_seen = online ? new Date().toISOString() : null;

            result[device.id] = {
                online, last_seen,
                health_code, last_error_code, seconds_in_error, device_name,
                requests_total, responses_valid_total, timeouts_total,
                transport_errors_total, consecutive_fail_current, consecutive_fail_max,
            };
        }
    }));

    return result;
}

module.exports = {
    modbusReadHoldingRegisters,
    readDevicesStatus,
};
