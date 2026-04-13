# Replicator Stack

Web-based control plane for MMA2 and Replicator.

---

## Test Setup (MMA + Replicator only)

Minimal Docker environment for testing MMA2 and Replicator without the web app.

### Requirements

- Docker Engine
- Docker Compose plugin

### Config Layout

```
data/
  mma/config.yaml         # MMA config — port 502, one unit
  replicator/config.yaml  # Replicator config — one device route
test/
  sim.py                  # Modbus TCP simulator (fake field device)
  verify.py               # Reads MMA registers and checks they match expected values
```

### Services

| Container    | Role |
|---|---|
| `mma`        | Modbus memory appliance (target) |
| `modbus-sim` | Simulated field device (source) with known register values |
| `replicator` | Polls `modbus-sim`, writes to `mma` |
| `verify`     | One-shot: reads `mma` and asserts values match (exits 0=pass, 1=fail) |

### Run end-to-end test

```bash
# Start all services
docker compose -f docker-compose.test.yaml up -d

# Wait for the verify container to finish, then check its exit code
docker wait verify

# 0 = PASS, 1 = FAIL
```

### View results

```bash
# See verify output (PASS/FAIL + register values)
docker logs verify

# See what the simulator is serving
docker logs modbus-sim

# See replicator polling activity
docker logs replicator

# See MMA startup
docker logs mma
```

### Run test non-interactively (CI-friendly)

```bash
docker compose -f docker-compose.test.yaml up -d && \
  docker wait verify && \
  docker inspect verify --format='{{.State.ExitCode}}'
```

Exit code 0 = test passed. Any other value = test failed.

### Stop and clean up

```bash
docker compose -f docker-compose.test.yaml down
```

---

## Full Stack

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the full stack (MMA + Replicator + Web App).

```bash
docker compose up -d --build
```

