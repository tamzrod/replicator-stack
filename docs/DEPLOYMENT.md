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