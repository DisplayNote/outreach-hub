#!/usr/bin/env bash
# Generates `infra/envs/prod.tfvars` (the single cloud environment) from
# `.env.bootstrap`. Idempotent. Run this only when deploying the prod cloud
# infrastructure — local development (`make bootstrap` + `make dev`) needs none
# of these values.
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

for v in GITHUB_REPO SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_REF SUPABASE_DB_PASSWORD \
         VERCEL_TOKEN VERCEL_ORG_ID VERCEL_PROJECT_ID \
         MS_CLIENT_ID MS_CLIENT_SECRET TF_STATE_KEY; do
  require "$v"
done

# ─── infra/envs/prod.tfvars (the only cloud environment) ────────────────────────
mkdir -p "$ROOT/infra/envs"
cat > "$ROOT/infra/envs/prod.tfvars" <<EOF
env = "prod"

supabase_access_token = "$SUPABASE_ACCESS_TOKEN"
supabase_project_ref  = "$SUPABASE_PROJECT_REF"
supabase_db_password  = "$SUPABASE_DB_PASSWORD"
supabase_region       = "eu-west-2"

vercel_token      = "$VERCEL_TOKEN"
vercel_org_id     = "$VERCEL_ORG_ID"
vercel_project_id = "$VERCEL_PROJECT_ID"

app_subdomain = "outreach"

ms_client_id     = "$MS_CLIENT_ID"
ms_client_secret = "$MS_CLIENT_SECRET"
EOF
echo "✓ wrote infra/envs/prod.tfvars"
echo
echo "Prod tfvars ready. Next: terraform -chdir=infra plan -var-file=envs/prod.tfvars"
