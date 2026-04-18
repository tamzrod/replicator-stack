@echo off
setlocal

set IMAGES=rodtamin/modbus-memory-appliance:2.3.4 rodtamin/modbus-replicator:v0.1.3 rodtamin/mcs-web:v0.6
set OUTPUT=images.tar

echo [*] Pulling images...
for %%I in (%IMAGES%) do (
    echo     Pulling %%I
    docker pull %%I
    if errorlevel 1 (
        echo [ERROR] Failed to pull %%I
        exit /b 1
    )
)

echo [*] Saving all images to %OUTPUT% ...
docker save -o %OUTPUT% %IMAGES%
if errorlevel 1 (
    echo [ERROR] docker save failed.
    exit /b 1
)

echo [OK] Saved to %OUTPUT%
endlocal
