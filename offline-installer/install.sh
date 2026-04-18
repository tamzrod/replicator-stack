#!/usr/bin/env bash
set -euo pipefail

TARFILE="images.tar"
COMPOSEFILE="docker-compose.yaml"

if [ ! -f "$TARFILE" ]; then
    echo "[ERROR] $TARFILE not found. Run pack.sh first or place the tar in this folder."
    exit 1
fi

echo "[*] Loading images from $TARFILE ..."
docker load -i "$TARFILE"

if [ ! -f "$COMPOSEFILE" ]; then
    echo "[WARN] $COMPOSEFILE not found. Skipping stack start."
    echo "[OK] Images loaded. Start the stack manually with: docker compose up -d"
    exit 0
fi

echo "[*] Starting stack with docker compose ..."
docker compose -f "$COMPOSEFILE" up -d

echo "[OK] Stack is running."
