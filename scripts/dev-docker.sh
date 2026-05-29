#!/usr/bin/env bash
# Boots Supabase through the CLI, then runs the production-style app container plus Mailpit.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env.local ]; then
  echo "ERROR: .env.local missing. Run \`make bootstrap\` first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
. ./.env.local
set +a

echo "[1/2] Starting Supabase through the CLI..."
pnpm exec supabase start

echo "[2/2] Starting Next.js app container and Mailpit..."
echo "App:             http://localhost:3000"
echo "Supabase API:    http://localhost:54321"
echo "Supabase Studio: http://localhost:54323"
echo "Mailpit Web:     http://localhost:8025"
docker compose --env-file .env.local -f docker-compose.full.yml up --build
