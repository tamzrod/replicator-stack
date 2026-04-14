# ROADMAP

## Phase 1 — Foundation

- [ ] Docker Compose working
- [ ] Web app running
- [ ] GET /config working

---

## Phase 2 — Control

- [ ] POST /config
- [ ] File write (atomic)
- [ ] Config validation

---

## Phase 3 — Deployment

- [ ] POST /deploy
- [ ] Restart MMA
- [ ] Wait for readiness
- [ ] Restart Replicator

---

## Phase 4 — Observability

- [ ] Modbus client
- [ ] Read raw registers
- [ ] Display in UI

---

## Phase 5 — UX

- [ ] Config editor UI
- [ ] Deploy button
- [ ] Status indicators

---

## Phase: Deployment Engine

- [ ] restart orchestration (stop Replicator → restart MMA → start Replicator)
- [ ] state tracking (DIRTY, DEPLOYING, SYNCING, READY)
- [ ] deployment status exposed via API
- [ ] MCS Web enforces restart sequence on every config change

---

## Future (Optional)

- Auth
- Config versioning
- Import/export

---

## Phase 6 — Configuration Modeling

- [ ] Grouped model support
- [ ] model.json storage
- [ ] compilation engine
- [ ] validation layer