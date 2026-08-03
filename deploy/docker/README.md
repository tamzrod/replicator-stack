# Docker Deployment

This folder contains the Docker Compose configuration for deploying the MMA (Modbus Memory Appliance) and Replicator services.

## Prerequisites

- Docker Engine
- Docker Compose plugin

## Quick Start

### 1. Navigate to the docker folder
```bash
cd deploy/docker
```

### 2. Create data directories (if not already present)
```bash
mkdir -p data/mma data/replicator
```

### 3. Pull latest images
```bash
docker compose pull
```

### 4. Start the stack
```bash
docker compose up -d
```

### 5. Verify services are running
```bash
docker ps
```

Expected output should show:
- mma
- replicator
- mcs-web

## Configuration

Configuration files for each service should be placed in:
- `data/mma/config.yaml` - MMA configuration
- `data/replicator/config.yaml` - Replicator configuration

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| APP_VERSION | latest | Application version tag |

## Service Details

### MMA (Modbus Memory Appliance)
- Image: `rodtamin/modbus-memory-appliance:latest`
- Network Mode: host
- Config Path: `/config/config.yaml`

### Replicator
- Image: `rodtamin/modbus-replicator:latest`
- Network: bridge (replicator-net)
- Config Path: `/config/config.yaml`
- Depends on: mma

### MCS Web
- Image: `rodtamin/mcs-web:v0.78`
- Port: 8080 (exposed on 8081)
- Network: bridge (replicator-net)
- Access: http://localhost:8081

## Useful Commands

```bash
# View logs
docker compose logs -f

# View logs for specific service
docker compose logs -f mma
docker compose logs -f replicator
docker compose logs -f web

# Restart services
docker compose restart

# Stop services
docker compose down

# Rebuild and restart
docker compose up -d --build
```

## Important Notes

- Never edit config inside containers directly
- Configuration changes require a deployment to take effect
- MMA memory is cleared on restart and rebuilt by the Replicator
