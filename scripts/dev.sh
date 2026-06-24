#!/usr/bin/env bash
# Boots the local stack: a Docker Postgres 16 + Mailpit, applies migrations, then
# runs `next dev`. The Supabase CLI is no longer used (Azure-native stack).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env.local ]; then
  echo "ERROR: .env.local missing. Run \`make bootstrap\` first." >&2
  exit 1
fi

# shellcheck source=scripts/lib/load-dotenv.sh
. "$ROOT/scripts/lib/load-dotenv.sh"
load_dotenv .env.local

echo "[1/3] Starting Postgres + Mailpit (docker compose)…"
docker compose -f docker-compose.dev.yml up -d

echo "      Waiting for Postgres to accept connections…"
for _ in $(seq 1 30); do
  if docker compose -f docker-compose.dev.yml exec -T postgres pg_isready -U postgres -d outreach >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker compose -f docker-compose.dev.yml exec -T postgres pg_isready -U postgres -d outreach >/dev/null 2>&1 || {
  echo "ERROR: Postgres did not become ready after 30 s. Check 'docker compose logs postgres'." >&2
  exit 1
}

echo "[2/3] Applying migrations (scripts/migrate.mjs)…"
node scripts/migrate.mjs

echo "[3/3] Starting Next.js dev server…"
echo "→ App:          http://localhost:3000"
echo "→ Postgres:     localhost:5433 (db outreach)"
echo "→ Mailpit Web:  http://localhost:8025"
pnpm dev
