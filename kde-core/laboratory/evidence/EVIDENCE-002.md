# Evidence: Technology Stack

**Template Version**: 1.0.0

---

## Metadata

| Field | Value |
|-------|-------|
| ID | EVIDENCE-002 |
| Category | evidence |
| Source | LAB-001 |
| Created | 2026-07-30 |
| Integrity Hash | (pending) |

---

## Evidence Content

### Statement

The system uses Express.js for the web backend, Modbus TCP for field communication, and Docker for containerization.

### Citations

**Source**: web/package.json
```json
{
  "name": "mcs-web",
  "version": "1.0.0",
  "dependencies": {
    "express": "^4.18.2"
  }
}
```

**Source**: docker-compose.test.yaml
```yaml
modbus-sim:
  image: python:3.12-slim
  command: >
    sh -c "pip install 'pymodbus==3.6.9' --quiet && python /test/sim.py"
```

**Source**: docker-compose.yaml
```yaml
mma:
  image: rodtamin/modbus-memory-appliance:2.3.4
replicator:
  image: rodtamin/modbus-replicator:latest
```

---

## Evidence Markup

```
[EVIDENCE: web/package.json - express: ^4.18.2]
[EVIDENCE: docker-compose.test.yaml - pymodbus==3.6.9]
[EVIDENCE: docker-compose.yaml - rodtamin/modbus-memory-appliance:2.3.4]
[EVIDENCE: web/Dockerfile - FROM node:20-alpine]
```
