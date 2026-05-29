#!/usr/bin/env bash
# Boots Supabase through the CLI, then runs the production-style app container plus Mailpit.
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

echo "[1/3] Stopping any running dev-stack Mailpit (frees ports 1025/8025)..."
# The full stack reuses Mailpit's host ports, so stop the lightweight dev-stack
# Mailpit first; otherwise switching from `make dev` hits a port bind conflict.
docker compose -f docker-compose.dev.yml down --remove-orphans \
  || echo "WARN: could not stop dev-stack Mailpit; free ports 1025/8025 if startup fails" >&2

echo "[2/3] Starting Supabase through the CLI..."
pnpm exec supabase start

echo "[3/3] Starting Next.js app container and Mailpit..."
echo "App:             http://localhost:3000"
echo "Supabase API:    http://localhost:54321"
echo "Supabase Studio: http://localhost:54323"
echo "Mailpit Web:     http://localhost:8025"
docker compose --env-file .env.local -f docker-compose.full.yml up --build
