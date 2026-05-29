Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $Root

if (-not (Test-Path -LiteralPath '.env.local')) {
  throw 'ERROR: .env.local missing. Run ./scripts/dev-bootstrap.ps1 first.'
}

. (Join-Path $PSScriptRoot 'lib/load-dotenv.ps1')
Import-Dotenv (Join-Path $Root '.env.local')

Write-Host '[1/3] Stopping any running dev-stack Mailpit (frees ports 1025/8025)...'
# The full stack reuses Mailpit's host ports, so stop the lightweight dev-stack
# Mailpit first; otherwise switching from `make dev` hits a port bind conflict.
docker compose -f docker-compose.dev.yml down --remove-orphans
if ($LASTEXITCODE -ne 0) {
  Write-Warning 'Could not stop dev-stack Mailpit; free ports 1025/8025 if startup fails.'
}

Write-Host '[2/3] Starting Supabase through the CLI...'
pnpm exec supabase start
if ($LASTEXITCODE -ne 0) { throw "Supabase failed to start (supabase start exited $LASTEXITCODE)." }

Write-Host '[3/3] Starting Next.js app container and Mailpit...'
Write-Host 'App:             http://localhost:3000'
Write-Host 'Supabase API:    http://localhost:54321'
Write-Host 'Supabase Studio: http://localhost:54323'
Write-Host 'Mailpit Web:     http://localhost:8025'
docker compose --env-file .env.local -f docker-compose.full.yml up --build
