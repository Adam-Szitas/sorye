# Run from any directory: powershell -ExecutionPolicy Bypass -File D:\projects\sorye\update-sandbox.ps1
[CmdletBinding()]
param([ValidateRange(30, 1800)][int]$TimeoutSeconds = 180)

$ErrorActionPreference = 'Stop'
$composePath = Join-Path $PSScriptRoot '.local/sandbox/compose.json'
function Invoke-Docker {
    param([string[]]$DockerArgs)
    & docker @DockerArgs
    if ($LASTEXITCODE -ne 0) { throw "Docker command failed (exit $LASTEXITCODE): $($DockerArgs -join ' ')" }
}

try {
    if (-not (Test-Path -LiteralPath $composePath)) {
        throw 'Sandbox configuration is missing. Follow sandbox/LOCAL.md to initialize it first.'
    }
    Invoke-Docker -DockerArgs @('info', '--format', '{{.ServerVersion}}')
    Invoke-Docker -DockerArgs @('compose', '-f', $composePath, 'config', '--quiet')
    # Rodrigo owns migrations; use its sibling repository, never copy its deployment files here.
    $folderMigration = Join-Path (Split-Path $PSScriptRoot -Parent) 'rodrigo/migrations/postgresql/014_drive_folders.sql'
    if (-not (Test-Path -LiteralPath $folderMigration)) { throw "Rodrigo folder migration missing: $folderMigration" }
    Invoke-Docker -DockerArgs @('compose', '-f', $composePath, 'up', '-d', '--wait', 'postgres')
    Get-Content -Raw -LiteralPath $folderMigration | & docker compose -f $composePath exec -T postgres psql -v ON_ERROR_STOP=1 -U sandbox -d sandbox
    if ($LASTEXITCODE -ne 0) { throw 'Rodrigo folder migration failed; sandbox update stopped.' }
    $shareMigration = Join-Path (Split-Path $PSScriptRoot -Parent) 'rodrigo/migrations/postgresql/015_drive_shares.sql'
    if (-not (Test-Path -LiteralPath $shareMigration)) { throw 'Rodrigo sharing migration is missing.' }
    Get-Content -Raw -LiteralPath $shareMigration | & docker compose -f $composePath exec -T postgres psql -v ON_ERROR_STOP=1 -U sandbox -d sandbox
    if ($LASTEXITCODE -ne 0) { throw 'Rodrigo sharing migration failed; sandbox update stopped.' }
    Write-Host 'Building Sorye and Rodrigo from current local source...'
    Invoke-Docker -DockerArgs @('compose', '-f', $composePath, 'build', 'hub', 'rodrigo')
    # Recreate together: remotes share the Hub image; Rodrigo shares its network
    # namespace. Ingress must resolve the newly created containers as well.
    Write-Host 'Updating sandbox containers (existing volumes and keys are preserved)...'
    Invoke-Docker -DockerArgs @('compose', '-f', $composePath, 'up', '-d', '--force-recreate', '--wait', '--wait-timeout', "$TimeoutSeconds")
    Invoke-Docker -DockerArgs @('compose', '-f', $composePath, 'exec', '-T', 'postgres', 'pg_isready', '-U', 'sandbox', '-d', 'sandbox')
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $ready = $false
    do {
        try {
            $capabilities = Invoke-RestMethod -Uri 'http://127.0.0.1:23000/api/backend/capabilities' -TimeoutSec 10
            $ready = $capabilities.service -eq 'rodrigo' -and $capabilities.dataReady -eq $true -and $capabilities.adapters.postgresql -eq 'ready' -and $capabilities.adapters.s3 -eq 'ready'
        } catch { $ready = $false }
        if (-not $ready) { Start-Sleep -Seconds 2 }
    } while (-not $ready -and (Get-Date) -lt $deadline)
    if (-not $ready) { throw 'Hub-to-Rodrigo readiness check timed out. Inspect sandbox container logs.' }
    Invoke-Docker -DockerArgs @('compose', '-f', $composePath, 'ps')
    Write-Host 'Sandbox updated: http://127.0.0.1:23000 — reload browser tabs to load the new app code.'
    Write-Host 'PostgreSQL and signed Hub-to-Rodrigo PostgreSQL/S3 capability checks passed. This does not certify every app workflow.'
} catch {
    Write-Error "Sandbox update failed: $_" -ErrorAction Continue
    exit 1
}
