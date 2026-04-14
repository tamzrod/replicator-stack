# RULES (STRICT)

## Authority

ONLY MCS Web can write config

---

## Source of Truth

/data/

---

## MMA Rules

- No UI
- No config control
- No logic

---

## Replicator Rules

- No UI
- No config control
- No orchestration

---

## MCS Web Rules

SHOULD:
- control
- configure
- observe

SHOULD NOT:
- interpret data
- scale values
- apply logic

---

## Forbidden

- Editing config inside containers
- Adding UI to MMA
- Adding UI to Replicator
- Moving orchestration away from MCS Web

---

## Runtime Configuration Rules

- **No hot reload** — configuration is loaded once at startup and never re-read while a service is running
- **All config changes require a full restart** — partial updates or live reloads are forbidden
- **MMA memory is ephemeral** — it is cleared on every MMA restart and fully rebuilt by the Replicator
- **MCS Web must orchestrate the restart sequence correctly**:
  1. Stop Replicator
  2. Restart MMA
  3. Start Replicator
- The Replicator is solely responsible for repopulating MMA memory after a restart
- MMA memory must never be treated as persistent or managed manually

---

## Configuration Rules

- Replicator config must remain flat — no groups, no hierarchy
- MCS Web owns all compilation logic — no compilation in MMA or Replicator
- Grouping exists in the UI/model layer only (`model.json`)
- No grouping logic may exist in any runtime service
- `model.json` is the human model; `config.yaml` is the runtime model
- Only the MCS Web may write either file

---

## Connection Discovery Rules

- Configuration files are the first source of truth for connection settings
- The MCS Web must not hardcode MMA or Replicator ports as architectural truth
- Service connection details (host, port, unit) must be read from config when available
- Fallback defaults are allowed only for bootstrap or recovery workflows, and must be presented to the user — never silently assumed
- If a config file is missing, the MCS Web must enter an uninitialized state and offer to create a starter config