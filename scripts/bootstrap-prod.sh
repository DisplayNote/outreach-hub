#!/usr/bin/env bash
# Generates `infra/envs/prod.tfvars` (the single cloud environment) from
# `.env.bootstrap`. Idempotent. Run this only when deploying the prod Azure
# infrastructure — local development (`make bootstrap` + `make dev`) needs none
# of these values.
#
# AUTH_SECRET / CRON_SECRET / UNSUBSCRIBE_SECRET are NOT generated here: Terraform
# creates them (random_password) and stores them in Key Vault.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BOOTSTRAP="$ROOT/.env.bootstrap"

if [ ! -f "$BOOTSTRAP" ]; then
  echo "ERROR: $BOOTSTRAP not found. Copy .env.bootstrap.example or follow section 4.6 of the execution plan." >&2
  exit 1
fi

# shellcheck source=scripts/lib/load-dotenv.sh
. "$ROOT/scripts/lib/load-dotenv.sh"
load_dotenv "$BOOTSTRAP"

require() {
  local var="$1"
  if [ -z "${!var:-}" ]; then
    echo "ERROR: required variable $var is empty in .env.bootstrap" >&2
    exit 1
  fi
}

for v in AZURE_SUBSCRIPTION_ID AZURE_TENANT_ID \
         PG_ADMIN_LOGIN PG_ADMIN_PASSWORD \
         AZURE_AD_CLIENT_ID AZURE_AD_CLIENT_SECRET AZURE_AD_TENANT_ID \
         CRON_ORG_ID CRON_SENDER_EMAIL; do
  require "$v"
done

# ─── infra/envs/prod.tfvars (the only cloud environment) ────────────────────────
mkdir -p "$ROOT/infra/envs"
cat > "$ROOT/infra/envs/prod.tfvars" <<EOF
env = "prod"

azure_subscription_id = "$AZURE_SUBSCRIPTION_ID"
azure_tenant_id       = "$AZURE_TENANT_ID"
azure_location        = "${AZURE_LOCATION:-uksouth}"

pg_admin_login    = "$PG_ADMIN_LOGIN"
pg_admin_password = "$PG_ADMIN_PASSWORD"

app_subdomain = "${APP_SUBDOMAIN:-outreach}"

azure_ad_client_id     = "$AZURE_AD_CLIENT_ID"
azure_ad_client_secret = "$AZURE_AD_CLIENT_SECRET"
azure_ad_tenant_id     = "$AZURE_AD_TENANT_ID"

admin_email_allowlist = "${ADMIN_EMAIL_ALLOWLIST:-}"
cron_org_id           = "$CRON_ORG_ID"
cron_sender_email     = "$CRON_SENDER_EMAIL"
EOF
echo "✓ wrote infra/envs/prod.tfvars"
echo
echo "Prod tfvars ready. Next: terraform -chdir=infra plan -var-file=envs/prod.tfvars"
