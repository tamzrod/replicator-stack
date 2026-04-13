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
- replicator-web

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
- Always edit via web app

---

## Startup Behaviour

When the web app starts:

- If config files exist under `/data/`: parse and display current state
- If config files are missing: the web app shows an uninitialized state and offers to create a starter config

The web app does not assume any fixed MMA or Replicator port. All connection details are read from config.