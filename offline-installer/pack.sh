#!/usr/bin/env bash
set -euo pipefail

IMAGES=(
    "rodtamin/modbus-memory-appliance:2.3.4"
    "rodtamin/modbus-replicator:v0.1.3"
    "rodtamin/mcs-web:v0.6"
)
OUTPUT="images.tar"

echo "[*] Pulling images..."
for img in "${IMAGES[@]}"; do
    echo "    Pulling $img"
    docker pull "$img"
done

echo "[*] Saving all images to $OUTPUT ..."
docker save -o "$OUTPUT" "${IMAGES[@]}"

echo "[OK] Saved to $OUTPUT"
