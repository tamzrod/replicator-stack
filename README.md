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
```

Update `data/replicator/config.yaml` to point `source.host` at your actual field device before starting.

### Start

```bash
docker compose -f docker-compose.test.yaml up -d
```

### Verify

```bash
# Check both containers are running
docker ps

# Expected output includes:
#   mma         rodtamin/modbus-memory-appliance:2.3.4   ...   0.0.0.0:502->502/tcp
#   replicator  rodtamin/modbus-replicator:latest        ...

# Check MMA is accepting Modbus TCP connections on port 502
docker logs mma

# Check Replicator is polling
docker logs replicator
```

### Stop

```bash
docker compose -f docker-compose.test.yaml down
```

---

## Full Stack

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the full stack (MMA + Replicator + Web App).

```bash
docker compose up -d --build
```
