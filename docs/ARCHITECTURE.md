# ARCHITECTURE

## High-Level Flow

User → Web UI  
↓  
Edit Config  
↓  
Write /data  
↓  
Restart Services  
↓  
Replicator → MMA  
↓  
Web reads MMA (Modbus)

---

## Component Responsibilities

### Web App

- Reads config
- Writes config
- Validates config
- Controls deployment
- Observes runtime

---

### MMA

- Serves Modbus TCP
- Stores raw registers
- No logic

---

### Replicator

- Polls devices
- Pushes data to MMA
- No logic beyond polling

---

## Restart Order

1. MMA
2. Wait until ready
3. Replicator

---

## Networking (Docker)

- Web connects to MMA via: mma:502
- Replicator pushes to MMA via TCP

---

## Storage

/data/
  mma/config.yaml
  replicator/config.yaml
  model.json

---

## Design Boundary

Web App:
- control
- configure
- observe

DO NOT:
- interpret values
- scale values
- apply control logic

---

## Configuration Compilation Pipeline

The Web App is solely responsible for translating the human-friendly grouped model into a flat replicator config.

### Flow

```
User edits grouped model (model.json)
  → validate (schema + business rules)
  → compile to flat routes
  → write /data/replicator/config.yaml
  → deploy (restart services)
```

### Rules

- Compilation happens inside the Web App only.
- Replicator consumes only the compiled flat output.
- Groups, devices, and blocks do not exist at the runtime level.
- Each compiled route retains `group_id`, `device_id`, and `block_id` reference fields for traceability.

See [COMPILATION.md](./COMPILATION.md) for full mapping rules and examples.