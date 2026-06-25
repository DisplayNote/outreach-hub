#!/usr/bin/env bash
# Stops the local stack (Postgres + Mailpit). Pass `-v` to also wipe the Postgres
# volume (destroys local data).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

volume_arg=()
if [ "${1:-}" = "-v" ]; then
  volume_arg=(-v)
fi

docker compose -f docker-compose.dev.yml down "${volume_arg[@]}" \
  || echo "WARN: docker compose down for docker-compose.dev.yml failed" >&2

echo "local stack stopped"
