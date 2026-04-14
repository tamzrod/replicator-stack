# MODEL — Grouped Configuration Model

## Overview

`/data/model.json` is the human model. It is the only place where grouping and hierarchy exist.

MCS Web compiles this file into the flat replicator config on every deployment.

---

## Structure

### Group

A logical grouping of devices. Used for UI organisation only.

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique identifier |
| `name` | string | Human-readable label |
| `devices` | array | List of devices in this group |

---

### Device

A physical field device (e.g. a Modbus RTU/TCP instrument).

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique identifier |
| `name` | string | Human-readable label |
| `port` | integer | Modbus TCP port |
| `unit_id` | integer | Modbus unit/slave ID |
| `blocks` | array | List of data blocks to poll |

> **Note:** The device host is auto-assigned by the backend from the `DEVICE_HOST` environment variable (default: `localhost`). It is not exposed in the UI or API.

---

### Block

A single Modbus read operation mapped to an MMA write target.

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique identifier |
| `name` | string | Human-readable label |
| `source_area` | string | Modbus function area (e.g. `holding_registers`) |
| `source_address` | integer | Starting register address |
| `source_count` | integer | Number of registers to read |
| `target_unit` | integer | MMA unit number |
| `target_area` | string | MMA memory area |
| `target_address` | integer | MMA starting address |
| `poll_interval` | integer | Poll frequency in milliseconds |

---

## Memory Allocation Model

MMA memory is allocated at the **block level**. Each block in the model defines a contiguous range of MMA registers that will be written by the Replicator.

- Memory allocation is defined by blocks — devices alone do not allocate memory
- Allocation is created on demand when the Replicator begins polling — there is no pre-allocation pool
- Memory is **not persistent** — it is cleared on every MMA restart
- Memory is **not managed manually** — it is rebuilt entirely by the Replicator after each restart
- Deleting a device removes all of its blocks, which removes the corresponding memory allocation on next deployment
- No cleanup logic is required — a restart always produces a clean, correct state

### Summary

| Rule | Behaviour |
|---|---|
| Allocation unit | Block |
| Allocation trigger | Replicator polling |
| Pre-allocation | None |
| Persistence | None — cleared on restart |
| Cleanup | None — restart resets all memory |

---

## Example: model.json

```json
{
  "groups": [
    {
      "id": "group-site-a",
      "name": "Site A",
      "devices": [
        {
          "id": "device-inverter-1",
          "name": "Inverter 1",
          "host": "192.168.1.10",
          "port": 502,
          "unit_id": 1,
          "blocks": [
            {
              "id": "block-power",
              "name": "Power Output",
              "source_area": "holding_registers",
              "source_address": 100,
              "source_count": 4,
              "target_unit": 1,
              "target_area": "holding_registers",
              "target_address": 0,
              "poll_interval": 1000
            },
            {
              "id": "block-status",
              "name": "Status Flags",
              "source_area": "coils",
              "source_address": 0,
              "source_count": 8,
              "target_unit": 1,
              "target_area": "coils",
              "target_address": 0,
              "poll_interval": 5000
            }
          ]
        },
        {
          "id": "device-meter-1",
          "name": "Energy Meter 1",
          "host": "192.168.1.11",
          "port": 502,
          "unit_id": 3,
          "blocks": [
            {
              "id": "block-energy",
              "name": "Energy Totals",
              "source_area": "holding_registers",
              "source_address": 200,
              "source_count": 8,
              "target_unit": 2,
              "target_area": "holding_registers",
              "target_address": 0,
              "poll_interval": 2000
            }
          ]
        }
      ]
    }
  ]
}
```
