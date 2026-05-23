#!/usr/bin/env bash
# Boots the full local stack: Docker (Mailpit), Supabase, and `next dev`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env.local ]; then
  echo "ERROR: .env.local missing. Run \`make bootstrap\` first." >&2
  exit 1
fi

echo "[1/3] Starting Mailpit (docker compose)…"
docker compose -f docker-compose.dev.yml up -d

echo "[2/3] Starting Supabase…"
pnpm exec supabase start

echo "[3/3] Starting Next.js dev server…"
echo "→ App:           http://localhost:3000"
echo "→ Supabase API:  http://localhost:54321"
echo "→ Supabase Stud: http://localhost:54323"
echo "→ Mailpit Web:   http://localhost:8025"
pnpm dev
