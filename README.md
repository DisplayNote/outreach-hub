# Outreach Hub

DisplayNote's multi-user outreach platform. Replaces the legacy single-file PWA
(`legacy/PaulsOutreachHub.html`) with a hosted Next.js + Supabase product.

## Quick start

Prerequisites: Node 20.18+, pnpm 11+, Docker Desktop, an `.env.bootstrap` file
(see [docs/deployment.md](docs/deployment.md) for §4 pre-flight).

```bash
git clone https://github.com/DisplayNote/outreach-hub.git
cd outreach-hub
make bootstrap   # populates .env.local and infra/envs/*.tfvars
make dev         # boots Mailpit + Supabase + Next.js
```

The first run pulls Supabase container images (1–5 min). After that:

| What | URL |
|---|---|
| App | http://localhost:3000 |
| Supabase Studio | http://localhost:54323 |
| Mailpit (dev SMTP UI) | http://localhost:8025 |
| Supabase API | http://localhost:54321 |

`make help` lists every target.

## Stack

- **Frontend** — Next.js 15 (App Router), TypeScript strict, Vercel hosting
- **Backend** — Supabase (Postgres + RLS + Auth + Realtime + Edge Functions + Vault + Storage)
- **Auth** — Microsoft Entra ID (Azure OIDC) via Supabase Auth, multi-tenant
- **Email** — pluggable `EmailDriver` interface: `mock` / `mailpit` / `graph-dev` / `graph-prod`
- **IaC** — Terraform in `infra/` (Supabase + Vercel + Cloudflare DNS)
- **CI/CD** — GitHub Actions (`ci`, `infra`, `db-migrate`, `functions-deploy`)
- **Tests** — Vitest (unit) + Playwright (e2e)

See [docs/architecture.md](docs/architecture.md) for the design.

## Repo layout

```
app/             Next.js App Router (routes, layouts, server components)
components/ui/   Reusable UI primitives (lands in Phase 1)
lib/
  env.ts         Zod-validated env access
  supabase/      Browser + server clients, SSR middleware helper
  email/         EmailDriver abstraction + mock/mailpit/graph implementations
  auth/          Auth helpers (lands in Phase 1)
supabase/
  migrations/    SQL migrations
  functions/     Deno edge functions
  config.toml    Local Supabase stack config
infra/           Terraform (Supabase + Vercel + Cloudflare)
.github/workflows/  CI/CD pipelines
tests/{unit,e2e}/   Vitest + Playwright tests
scripts/         dev-bootstrap.sh, dev.sh, teardown.sh
docs/            development.md, architecture.md, deployment.md
legacy/          Original PaulsOutreachHub.html + Cloudflare AMD worker (reference only)
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch/commit conventions.
PRs must keep `pnpm typecheck`, `pnpm lint`, and `pnpm test` green.

## Status

Phase 0 — bootstrap complete.
See [docs/OUTREACH_HUB_EXECUTION_PLAN.md](docs/OUTREACH_HUB_EXECUTION_PLAN.md) for the roadmap.
