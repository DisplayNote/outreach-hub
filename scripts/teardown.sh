#!/usr/bin/env bash
# Stops the full local stack. Use \`-v\` arg to also wipe docker volumes (rare).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

pnpm exec supabase stop || true

if [ "${1:-}" = "-v" ]; then
  docker compose -f docker-compose.dev.yml down -v
else
  docker compose -f docker-compose.dev.yml down
fi

echo "✓ local stack stopped"
