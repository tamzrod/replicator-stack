$ErrorActionPreference = "Stop"

$TarFile    = "images.tar"
$ComposeFile = "docker-compose.yaml"

if (-not (Test-Path $TarFile)) {
    throw "$TarFile not found. Run pack.ps1 first or place the tar in this folder."
}

Write-Host "[*] Loading images from $TarFile ..."
docker load -i $TarFile
if ($LASTEXITCODE -ne 0) { throw "docker load failed" }

if (-not (Test-Path $ComposeFile)) {
    Write-Host "[WARN] $ComposeFile not found. Skipping stack start."
    Write-Host "[OK] Images loaded. Start the stack manually with: docker compose up -d"
    exit 0
}

Write-Host "[*] Starting stack with docker compose ..."
docker compose -f $ComposeFile up -d
if ($LASTEXITCODE -ne 0) { throw "docker compose up failed" }

Write-Host "[OK] Stack is running."
