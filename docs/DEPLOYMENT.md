# DEPLOYMENT

## Requirements

- Docker Engine
- Docker Compose plugin

---

## Install Docker Compose

sudo apt update
sudo apt install docker-compose-plugin -y

---

## Run Stack

docker compose up -d --build

---

## Verify

docker ps

Expected:
- mma
- replicator
- mcs-web

---

## Access

http://localhost:8081

---

## Restart Flow

Triggered by API:

POST /deploy

---

## Important

- Never edit config inside containers
- Always edit via MCS Web

---

## Deployment Behavior

A deployment is **required** after every configuration change. Configuration does not take effect until the system is restarted.

- Deployment resets the entire runtime state
- MMA memory is cleared on restart and rebuilt from scratch by the Replicator
- The system derives all runtime state from the current config files — there is no persistent state

### What Deployment Does

1. Compiles `model.json` → `config.yaml`
2. Stops the Replicator
3. Restarts MMA (memory is cleared)
4. Starts the Replicator with the new config
5. Replicator polls devices and repopulates MMA memory

### Rules

- Never skip a deployment after editing config — changes have no effect until deployed
- Never restart services out of sequence — MMA must be restarted before the Replicator
- The system is always rebuilt from source (config files) on every deploy

---

## Startup Behaviour

When MCS Web starts:

- If config files exist under `/data/`: parse and display current state
- If config files are missing: MCS Web shows an uninitialized state and offers to create a starter config

MCS Web does not assume any fixed MMA or Replicator port. All connection details are read from config.