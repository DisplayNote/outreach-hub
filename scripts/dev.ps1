Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $Root

if (-not (Test-Path -LiteralPath '.env.local')) {
  throw 'ERROR: .env.local missing. Run ./scripts/dev-bootstrap.ps1 first.'
}

. (Join-Path $PSScriptRoot 'lib/load-dotenv.ps1')
Import-Dotenv (Join-Path $Root '.env.local')

Write-Host '[1/3] Starting Mailpit...'
docker compose -f docker-compose.dev.yml up -d
if ($LASTEXITCODE -ne 0) { throw "Mailpit failed to start (docker compose exited $LASTEXITCODE)." }

Write-Host '[2/3] Starting Supabase...'
pnpm exec supabase start
if ($LASTEXITCODE -ne 0) { throw "Supabase failed to start (supabase start exited $LASTEXITCODE)." }

Write-Host '[3/3] Starting Next.js dev server...'
Write-Host 'App:             http://localhost:3000'
Write-Host 'Supabase API:    http://localhost:54321'
Write-Host 'Supabase Studio: http://localhost:54323'
Write-Host 'Mailpit Web:     http://localhost:8025'
pnpm dev
