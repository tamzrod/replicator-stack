# COMPILATION — Grouped Model to Flat Config

## Overview

The Web App compiles `/data/model.json` into `/data/replicator/config.yaml`.

Replicator receives only the flat output. It has no knowledge of groups, devices, or blocks.

---

## How It Works

The compiler walks the model hierarchy and emits one flat route per block:

```
for each group:
  for each device in group.devices:
    for each block in device.blocks:
      emit route
```

---

## Mapping Rules

Each route is derived as follows:

| Route Field | Source |
|---|---|
| `id` | `{group.id}__{device.id}__{block.id}` |
| `source.host` | `device.host` |
| `source.port` | `device.port` |
| `source.unit_id` | `device.unit_id` |
| `source.area` | `block.source_area` |
| `source.address` | `block.source_address` |
| `source.count` | `block.source_count` |
| `target.unit` | `block.target_unit` |
| `target.area` | `block.target_area` |
| `target.address` | `block.target_address` |
| `poll_interval` | `block.poll_interval` |
| `ref.group_id` | `group.id` |
| `ref.device_id` | `device.id` |
| `ref.block_id` | `block.id` |

---

## Route ID Naming Convention

```
{group_id}__{device_id}__{block_id}
```

- Uses double underscore (`__`) as separator
- All segments must be unique within their parent scope
- IDs should use lowercase letters, digits, and hyphens only

Example: `group-site-a__device-inverter-1__block-power`

---

## Example

### Input: model.json (excerpt)

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
            }
          ]
        }
      ]
    }
  ]
}
```

### Output: config.yaml

```yaml
routes:
  - id: group-site-a__device-inverter-1__block-power
    source:
      host: 192.168.1.10
      port: 502
      unit_id: 1
      area: holding_registers
      address: 100
      count: 4
    target:
      unit: 1
      area: holding_registers
      address: 0
    poll_interval: 1000
    ref:
      group_id: group-site-a
      device_id: device-inverter-1
      block_id: block-power
```

---

## Validation

Before compiling, the Web App must validate:

- All IDs are non-empty and unique within their scope
- `source_count` is greater than zero
- `poll_interval` is greater than zero
- `host` is a non-empty string
- `port` is in the range 1–65535
- `unit_id` is in the range 0–247
- `source_area` and `target_area` are recognised Modbus area types

Compilation must not proceed if validation fails.
