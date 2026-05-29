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

Write-Host '[1/3] Starting Mailpit...'
docker compose -f docker-compose.dev.yml up -d

Write-Host '[2/3] Starting Supabase...'
pnpm exec supabase start

Write-Host '[3/3] Starting Next.js dev server...'
Write-Host 'App:             http://localhost:3000'
Write-Host 'Supabase API:    http://localhost:54321'
Write-Host 'Supabase Studio: http://localhost:54323'
Write-Host 'Mailpit Web:     http://localhost:8025'
pnpm dev
