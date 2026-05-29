# ADR 005: Node 24 runtime baseline

## Status

Accepted.

## Context

The repository already pins `pnpm@11.2.2`. During Docker verification on 2026-05-29, the
Node 20.18 image failed in two ways:

- Corepack bundled with Node 20.18 could not verify the current pnpm package signature.
- Installing pnpm directly showed that pnpm 11.2.2 requires Node `>=22.13` and then failed on
  missing `node:sqlite`.

The local workstation was already running Node 24.13.0 successfully.

## Decision

Use Node 24.13.0 as the project runtime baseline:

- `.nvmrc` is `24.13.0`.
- `package.json#engines.node` is `>=24.13.0`.
- `Dockerfile` uses `node:24.13.0-alpine`.

The Dockerfile installs the pinned pnpm version with `npm install -g pnpm@11.2.2` instead of
using Corepack, keeping the package-manager version deterministic while avoiding the stale
Corepack trust-store failure.

## Consequences

CI continues to read `.nvmrc`, so GitHub Actions follows the same baseline. Developers should
use `nvm install` or an equivalent Node manager before running pnpm commands.
