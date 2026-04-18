@echo off
setlocal

set TARFILE=images.tar
set COMPOSEFILE=docker-compose.yaml

if not exist "%TARFILE%" (
    echo [ERROR] %TARFILE% not found. Run pack.bat first or place the tar in this folder.
    exit /b 1
)

echo [*] Loading images from %TARFILE% ...
docker load -i %TARFILE%
if errorlevel 1 (
    echo [ERROR] docker load failed.
    exit /b 1
)

if not exist "%COMPOSEFILE%" (
    echo [WARN] %COMPOSEFILE% not found. Skipping stack start.
    echo [OK] Images loaded. Start the stack manually with: docker compose up -d
    exit /b 0
)

echo [*] Starting stack with docker compose ...
docker compose -f %COMPOSEFILE% up -d
if errorlevel 1 (
    echo [ERROR] docker compose up failed.
    exit /b 1
)

echo [OK] Stack is running.
endlocal
