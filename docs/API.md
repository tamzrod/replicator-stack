# API SPEC

## GET /

Health check

Response:
200 OK

---

## GET /config

Returns current config

Response:
{
  "mma": {...},
  "replicator": {...}
}

---

## POST /config

Update config

Request:
{
  "mma": {...},
  "replicator": {...}
}

Behavior:
- Validate config
- Write to /data
- Do NOT restart

---

## POST /deploy

Triggers deployment

Behavior:
1. Restart MMA
2. Wait for MMA ready
3. Restart Replicator

Response:
{
  "status": "deploying"
}

---

## GET /runtime (future)

Reads raw Modbus data from MMA

Response:
{
  "registers": [...]
}