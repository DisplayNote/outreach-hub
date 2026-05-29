Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $Root

if (-not (Test-Path -LiteralPath '.env.local')) {
  throw 'ERROR: .env.local missing. Run ./scripts/dev-bootstrap.ps1 first.'
}

foreach ($Line in Get-Content -LiteralPath '.env.local') {
  $Trimmed = $Line.Trim()
  if ($Trimmed.Length -eq 0 -or $Trimmed.StartsWith('#')) {
    continue
  }

  $Parts = $Trimmed -split '=', 2
  if ($Parts.Length -ne 2) {
    continue
  }

  [Environment]::SetEnvironmentVariable($Parts[0].Trim(), $Parts[1].Trim(), 'Process')
}

Write-Host '[1/2] Starting Supabase through the CLI...'
pnpm exec supabase start
if ($LASTEXITCODE -ne 0) { throw "Supabase failed to start (supabase start exited $LASTEXITCODE)." }

Write-Host '[2/2] Starting Next.js app container and Mailpit...'
Write-Host 'App:             http://localhost:3000'
Write-Host 'Supabase API:    http://localhost:54321'
Write-Host 'Supabase Studio: http://localhost:54323'
Write-Host 'Mailpit Web:     http://localhost:8025'
docker compose --env-file .env.local -f docker-compose.full.yml up --build
