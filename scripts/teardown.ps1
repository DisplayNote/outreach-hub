param(
  [switch] $Volumes
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $Root

$DownArgs = @('compose', '-f', 'docker-compose.dev.yml', 'down')
if ($Volumes) {
  $DownArgs += '-v'
}
try {
  docker @DownArgs
  if ($LASTEXITCODE -ne 0) { throw "docker compose down exited $LASTEXITCODE" }
} catch {
  Write-Warning "docker compose down for docker-compose.dev.yml failed: $($_.Exception.Message)"
}

Write-Host 'local stack stopped'
