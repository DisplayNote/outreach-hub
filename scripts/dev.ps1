Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $Root

if (-not (Test-Path -LiteralPath '.env.local')) {
  throw 'ERROR: .env.local missing. Run ./scripts/dev-bootstrap.ps1 first.'
}

. (Join-Path $PSScriptRoot 'lib/load-dotenv.ps1')
Import-Dotenv (Join-Path $Root '.env.local')

Write-Host '[1/3] Starting Postgres + Mailpit...'
docker compose -f docker-compose.dev.yml up -d
if ($LASTEXITCODE -ne 0) { throw "docker compose up failed (exited $LASTEXITCODE)." }

Write-Host '      Waiting for Postgres to accept connections...'
for ($i = 0; $i -lt 30; $i++) {
  docker compose -f docker-compose.dev.yml exec -T postgres pg_isready -U postgres -d outreach *> $null
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep -Seconds 1
}

Write-Host '[2/3] Applying migrations (scripts/migrate.mjs)...'
node scripts/migrate.mjs
if ($LASTEXITCODE -ne 0) { throw "migrations failed (exited $LASTEXITCODE)." }

Write-Host '[3/3] Starting Next.js dev server...'
Write-Host 'App:          http://localhost:3000'
Write-Host 'Postgres:     localhost:5433 (db outreach)'
Write-Host 'Mailpit Web:  http://localhost:8025'
pnpm dev
