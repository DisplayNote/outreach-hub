Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Generates infra/envs/prod.tfvars (the single cloud environment) from
# .env.bootstrap. Idempotent. Run this only when deploying the prod Azure
# infrastructure — local development (dev-bootstrap.ps1 + make dev) needs none
# of these values.
#
# AUTH_SECRET / CRON_SECRET / UNSUBSCRIBE_SECRET are NOT generated here: Terraform
# creates them (random_password) and stores them in Key Vault.

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
  'AZURE_SUBSCRIPTION_ID',
  'AZURE_TENANT_ID',
  'PG_ADMIN_LOGIN',
  'PG_ADMIN_PASSWORD',
  'AZURE_AD_CLIENT_ID',
  'AZURE_AD_CLIENT_SECRET',
  'AZURE_AD_TENANT_ID',
  'CRON_ORG_ID',
  'CRON_SENDER_EMAIL'
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

$Location = if ($Vars.ContainsKey('AZURE_LOCATION') -and -not [string]::IsNullOrWhiteSpace($Vars['AZURE_LOCATION'])) { $Vars['AZURE_LOCATION'] } else { 'uksouth' }
$Subdomain = if ($Vars.ContainsKey('APP_SUBDOMAIN') -and -not [string]::IsNullOrWhiteSpace($Vars['APP_SUBDOMAIN'])) { $Vars['APP_SUBDOMAIN'] } else { 'outreach' }
$Allowlist = if ($Vars.ContainsKey('ADMIN_EMAIL_ALLOWLIST')) { $Vars['ADMIN_EMAIL_ALLOWLIST'] } else { '' }

$ProdTfvars = @"
env = "prod"

azure_subscription_id = "$($Vars['AZURE_SUBSCRIPTION_ID'])"
azure_tenant_id       = "$($Vars['AZURE_TENANT_ID'])"
azure_location        = "$Location"

pg_admin_login    = "$($Vars['PG_ADMIN_LOGIN'])"
pg_admin_password = "$($Vars['PG_ADMIN_PASSWORD'])"

app_subdomain = "$Subdomain"

azure_ad_client_id     = "$($Vars['AZURE_AD_CLIENT_ID'])"
azure_ad_client_secret = "$($Vars['AZURE_AD_CLIENT_SECRET'])"
azure_ad_tenant_id     = "$($Vars['AZURE_AD_TENANT_ID'])"

admin_email_allowlist = "$Allowlist"
cron_org_id           = "$($Vars['CRON_ORG_ID'])"
cron_sender_email     = "$($Vars['CRON_SENDER_EMAIL'])"
"@

Write-Utf8NoBom -Path (Join-Path $EnvDir 'prod.tfvars') -Content $ProdTfvars
Write-Host 'wrote infra/envs/prod.tfvars'
Write-Host ''
Write-Host 'Prod tfvars ready. Next: terraform -chdir=infra plan -var-file=envs/prod.tfvars'
