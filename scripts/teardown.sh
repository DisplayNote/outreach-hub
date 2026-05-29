#!/usr/bin/env bash
# Stops the full local stack. Use \`-v\` arg to also wipe docker volumes (rare).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

pnpm exec supabase stop || echo "WARN: supabase stop failed" >&2

volume_arg=()
if [ "${1:-}" = "-v" ]; then
  volume_arg=(-v)
fi

docker compose -f docker-compose.dev.yml down "${volume_arg[@]}" \
  || echo "WARN: docker compose down for docker-compose.dev.yml failed" >&2
docker compose -f docker-compose.full.yml down "${volume_arg[@]}" \
  || echo "WARN: docker compose down for docker-compose.full.yml failed" >&2

echo "local stack stopped"
