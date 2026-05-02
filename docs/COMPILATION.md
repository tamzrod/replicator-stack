# COMPILATION — Grouped Model to Flat Config

## Overview

The MCS Web compiles `/data/model.json` into `/data/replicator/config.yaml`.

Replicator receives only the flat output. It has no knowledge of groups, devices, or blocks beyond what is encoded in unit IDs.

---

## How It Works

The compiler walks the model hierarchy and emits one unit per device:

```
for each device:
  emit unit with source, reads (one per block), targets, and poll interval
```

---

## Replicator Config Format

The compiled replicator config uses the `replicator.units` format:

```yaml
replicator:
  units:
    - id: "<device.id>"
      source:
        endpoint: "<device.ipAddress>:<device.port>"
        unit_id: <device.source_unit_id>
        device_name: "<device.id>"
        status_slot: <device.status_slot>   # only if status_unit_id is configured
      reads:
        - fc: <function_code>         # derived from block.source_area
          address: <block.source_address>
          quantity: <block.source_count>
      targets:
        - id: <device.unitId>
          endpoint: "<target.endpoint>"
          unit_id: <device.unitId>
          status_unit_id: <target.status_unit_id>   # if configured
          memories:
            - memory_id: <device.unitId>
              offsets: {}
      poll:
        interval_ms: <min(block.poll_interval) across device>
```

---

## MMA Config Format

The compiled MMA config uses the `listeners` format:

```yaml
listeners:
  - id: main
    listen: ":<port>"
    memory:
      - unit_id: <device.unitId>
        holding_registers:
          start: <min source_address across blocks for this unit>
          count: <span of address range for holding register blocks>
        policy:
          rules:
            - id: read-only
              source_ip:
                - 0.0.0.0/0
                - ::/0
              allow_fc: [3]
```

Each area is represented as a single scalar `start`/`count` range. When a unit has multiple non-contiguous segments internally, the compiler spans them into the widest contiguous range for the MMA binary. The `segments:` wrapper key is **not** part of the MMA2 schema and must never appear in generated config.

---

## Mapping Rules

### Replicator Unit

| Unit Field | Source |
|---|---|
| `id` | `device.id` |
| `source.endpoint` | `"{device.ipAddress}:{device.port}"` |
| `source.unit_id` | `device.source_unit_id` |
| `source.device_name` | `device.name` (falls back to `device.id` if name is unset) |
| `source.status_slot` | `device.status_slot` (default 0, only emitted when `status_unit_id` is set) |
| `reads[].fc` | Modbus FC from `block.source_area` (see table below) |
| `reads[].address` | `block.source_address` |
| `reads[].quantity` | `block.source_count` |
| `targets[].id` | `device.unitId` |
| `targets[].endpoint` | `target.endpoint` |
| `targets[].unit_id` | `device.unitId` |
| `targets[].status_unit_id` | `target.status_unit_id` (if set) |
| `targets[].memories[].memory_id` | `device.unitId` |
| `targets[].memories[].offsets` | `{}` (no address offset) |
| `poll.interval_ms` | minimum `block.poll_interval` across device blocks |

### Modbus Function Code Mapping

| `source_area` | FC |
|---|---|
| `holding_registers` | 3 |
| `coils` | 1 |
| `input_registers` | 4 |
| `discrete_inputs` | 2 |

### MMA Unit

| Field | Source |
|---|---|
| `unit_id` | `device.unitId` |
| `holding_registers.start` | `min(block.source_address)` for holding register blocks on this unit |
| `holding_registers.count` | `max(block.source_address + block.source_count) - start` |

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

### Output: replicator/config.yaml

```yaml
replicator:
  units:
    - id: "device-inverter-1"
      source:
        endpoint: "192.168.1.10:502"
        unit_id: 1
        device_name: "device-inverter-1"
        status_slot: 0
      reads:
        - fc: 3
          address: 100
          quantity: 4
      targets:
        - id: 1
          endpoint: "mma:502"
          unit_id: 1
          memories:
            - memory_id: 1
              offsets: {}
      poll:
        interval_ms: 1000
```

### Output: mma/config.yaml

```yaml
listeners:
  - id: main
    listen: ":502"
    memory:
      - unit_id: 1
        holding_registers:
          start: 100
          count: 4
        policy:
          rules:
            - id: read-only
              source_ip:
                - 0.0.0.0/0
                - ::/0
              allow_fc: [3]
```

---

## Validation

Before compiling, the MCS Web must validate:

- All IDs are non-empty and unique within their scope
- `source_count` is greater than zero
- `poll_interval` is greater than zero
- `host` is a non-empty string
- `port` is in the range 1–65535
- `unit_id` is in the range 0–247
- `source_area` and `target_area` are recognised Modbus area types

Compilation must not proceed if validation fails.
