$ErrorActionPreference = "Stop"

$Images = @(
    "rodtamin/modbus-memory-appliance:2.3.4",
    "rodtamin/modbus-replicator:v0.1.3",
    "rodtamin/mcs-web:v0.6"
)
$Output = "images.tar"

Write-Host "[*] Pulling images..."
foreach ($img in $Images) {
    Write-Host "    Pulling $img"
    docker pull $img
    if ($LASTEXITCODE -ne 0) { throw "Failed to pull $img" }
}

Write-Host "[*] Saving all images to $Output ..."
docker save -o $Output $Images
if ($LASTEXITCODE -ne 0) { throw "docker save failed" }

Write-Host "[OK] Saved to $Output"
