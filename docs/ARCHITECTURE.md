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

- Replicator pushes data to MMA via TCP
- Web App reads MMA connection details from config — not from hardcoded defaults
- Actual host and port are determined at runtime by reading the MMA config file

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

## Deployment Lifecycle

Every configuration change follows this pipeline before taking effect:

```
Edit → Save → Compile → Restart → Sync
```

| Step | Actor | Action |
|---|---|---|
| Edit | User | Modifies model via Web UI |
| Save | Web App | Writes `model.json` to `/data/` |
| Compile | Web App | Transforms `model.json` → `config.yaml` |
| Restart | Web App | Orchestrates the restart sequence |
| Sync | Replicator | Polls devices and repopulates MMA memory |

### Restart Sequence

```
1. Stop Replicator
2. Restart MMA         ← MMA memory is cleared
3. Start Replicator    ← reads new config.yaml
4. Replicator repopulates MMA from devices
```

- MMA memory is **ephemeral** — it is fully cleared on every restart
- MMA memory is **rebuilt automatically** by the Replicator after each restart
- No manual cleanup or memory management is required

### Rules

- Configuration takes effect **only on restart** — there is no hot reload
- The Web App must always execute the full restart sequence in the correct order
- Partial restarts (e.g. restarting only Replicator without clearing MMA) are not permitted for config changes

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

---

## Configuration Discovery and Initialization

The Web App must never assume fixed service ports or hostnames. All connection details are read from config files at startup.

### Startup Behaviour

```
Web App starts
  → check /data/mma/config.yaml
    → exists: parse and use connection details
    → missing: show uninitialized state, offer starter config creation
  → check /data/replicator/config.yaml
    → exists: parse and display
    → missing: show uninitialized state, offer starter config creation
```

### Rules

- Config files are the first source of truth for all connection settings.
- The Web App must not hardcode service ports or hostnames as architectural truth.
- If a config file is absent, the Web App enters an uninitialized state and may offer to create a starter config.
- Fallback defaults (e.g. `mma:502`) are permitted only as bootstrap suggestions shown to the user — never silently applied as assumptions.
- Once config is written, all subsequent connections derive from that file.