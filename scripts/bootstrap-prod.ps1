Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Generates infra/envs/prod.tfvars (the single cloud environment) from
# .env.bootstrap. Idempotent. Run this only when deploying the prod cloud
# infrastructure — local development (dev-bootstrap.ps1 + make dev) needs none
# of these values.

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Bootstrap = Join-Path $Root '.env.bootstrap'

if (-not (Test-Path -LiteralPath $Bootstrap)) {
  throw "ERROR: $Bootstrap not found. Copy .env.bootstrap.example or follow section 4.6 of the execution plan."
}

. (Join-Path $PSScriptRoot 'lib/load-dotenv.ps1')
$Vars = Read-DotenvFile -Path $Bootstrap

function Require-BootstrapValue {
  param([Parameter(Mandatory = $true)][string] $Name)

  if (-not $Vars.ContainsKey($Name) -or [string]::IsNullOrWhiteSpace($Vars[$Name])) {
    throw "ERROR: required variable $Name is empty in .env.bootstrap"
  }
}

@(
  'GITHUB_REPO',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_PROJECT_REF',
  'SUPABASE_DB_PASSWORD',
  'VERCEL_TOKEN',
  'VERCEL_ORG_ID',
  'VERCEL_PROJECT_ID',
  'MS_CLIENT_ID',
  'MS_CLIENT_SECRET',
  'TF_STATE_KEY'
) | ForEach-Object { Require-BootstrapValue $_ }

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory = $true)][string] $Path,
    [Parameter(Mandatory = $true)][string] $Content
  )
  [System.IO.File]::WriteAllText($Path, $Content + "`n", (New-Object System.Text.UTF8Encoding($false)))
}

$EnvDir = Join-Path $Root 'infra/envs'
New-Item -ItemType Directory -Force -Path $EnvDir | Out-Null

$ProdTfvars = @"
env = "prod"

supabase_access_token = "$($Vars['SUPABASE_ACCESS_TOKEN'])"
supabase_project_ref  = "$($Vars['SUPABASE_PROJECT_REF'])"
supabase_db_password  = "$($Vars['SUPABASE_DB_PASSWORD'])"
supabase_region       = "eu-west-2"

vercel_token      = "$($Vars['VERCEL_TOKEN'])"
vercel_org_id     = "$($Vars['VERCEL_ORG_ID'])"
vercel_project_id = "$($Vars['VERCEL_PROJECT_ID'])"

app_subdomain = "outreach"

ms_client_id     = "$($Vars['MS_CLIENT_ID'])"
ms_client_secret = "$($Vars['MS_CLIENT_SECRET'])"
"@

Write-Utf8NoBom -Path (Join-Path $EnvDir 'prod.tfvars') -Content $ProdTfvars
Write-Host 'wrote infra/envs/prod.tfvars'
Write-Host ''
Write-Host 'Prod tfvars ready. Next: terraform -chdir=infra plan -var-file=envs/prod.tfvars'
