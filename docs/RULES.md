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