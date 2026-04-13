# RULES (STRICT)

## Authority

ONLY Web App can write config

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

## Web App Rules

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
- Moving orchestration away from Web App

---

## Configuration Rules

- Replicator config must remain flat — no groups, no hierarchy
- Web App owns all compilation logic — no compilation in MMA or Replicator
- Grouping exists in the UI/model layer only (`model.json`)
- No grouping logic may exist in any runtime service
- `model.json` is the human model; `config.yaml` is the runtime model
- Only the Web App may write either file