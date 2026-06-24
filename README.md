# Outreach Hub

DisplayNote's multi-user outreach platform. Replaces the legacy single-file PWA
(`legacy/PaulsOutreachHub.html`) with a hosted Next.js app on Azure.

## Quick start

Prerequisites: Node 24.13+ (see `.nvmrc`), pnpm 11+, Docker Desktop running, and
an `.env.bootstrap` file (copy `.env.bootstrap.example`; for local dev you only
need the Microsoft `MS_*` values).

```bash
git clone https://github.com/DisplayNote/outreach-hub.git
cd outreach-hub
pnpm install
cp .env.bootstrap.example .env.bootstrap   # fill the MS_* values for local dev
make bootstrap   # writes .env.local (no cloud account needed)
make dev         # docker Postgres 16 + Mailpit → run migrations → next dev
```

`make dev` brings up a local Postgres + Mailpit, applies the SQL migrations
(`scripts/migrate.mjs`), and starts `next dev`. `make seed` loads a
full-coverage dataset. Sign in via the dev login (enabled only on a loopback
`APP_BASE_URL`); no Microsoft round-trip needed locally.

Windows without GNU Make: `Copy-Item .env.bootstrap.example .env.bootstrap`, fill
it, then `.\scripts\dev-bootstrap.ps1` and `.\scripts\dev.ps1`.

| What | URL |
|---|---|
| App | http://localhost:3000 |
| Mailpit (dev SMTP UI) | http://localhost:8025 |
| Postgres | localhost:5433 (db `outreach`) |

`make help` lists every target. Deploying to Azure: see
[docs/deployment.md](docs/deployment.md) (`make bootstrap-prod` → Terraform).

## Stack

- **Frontend / hosting** — Next.js 15 (App Router, `output: 'standalone'`), TypeScript strict, on **Azure Container Apps** (image in ACR)
- **Database** — **Azure Database for PostgreSQL Flexible Server**; data access is `pg` + Drizzle behind `withRls(ctx, fn)` (a per-request tx that sets the `app.user_id`/`app.org_id` GUCs the **RLS** policies read). Secrets in **Azure Key Vault**
- **Auth** — Microsoft Entra ID via **Auth.js v5**, tenant-pinned; the signed JWT feeds the RLS context
- **Email** — pluggable `EmailDriver`: `mock` / `mailpit` / `graph-dev` / `graph-prod`; scheduled send/scan run as **ACA Jobs**
- **Local runtime** — Docker Postgres 16 + Mailpit (`docker-compose.dev.yml`)
- **IaC** — Terraform `azurerm` in `infra/`; DNS managed manually
- **CI/CD** — GitHub Actions (`ci`, `infra`, `deploy`, `db-migrate`) via Azure OIDC
- **Tests** — Vitest (unit) + Playwright (e2e)

See [docs/architecture.md](docs/architecture.md) for the design, and the
migration record at `docs/superpowers/plans/2026-06-23-azure-migration.md`.

## Repo layout

```
app/             Next.js App Router (routes, layouts, server components)
components/      UI components
lib/
  env.ts         Zod-validated env access
  db/            pg pool + Drizzle, withRls / withServiceRls, schema, escapeLike
  auth/          Auth.js config, session→RLS helpers, provisioning, admin allowlist, Graph tokens
  email/         EmailDriver abstraction + mock/mailpit/graph + cron cores
  graph/         delegated + app-only (MSAL) Microsoft Graph tokens
supabase/migrations/  Plain SQL migrations (applied by scripts/migrate.mjs; legacy dir name)
infra/           Terraform azurerm (RG, ACR, Postgres, Key Vault, Container App, cron Jobs)
.github/workflows/   CI/CD pipelines (ci, infra, deploy, db-migrate)
docker-compose.dev.yml  Local Postgres 16 + Mailpit
scripts/         dev-bootstrap, dev, teardown, migrate.mjs, seed-dev.mjs
tests/{unit,e2e}/    Vitest + Playwright tests
docs/            development.md, architecture.md, deployment.md
legacy/          Original PaulsOutreachHub.html (reference only)
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch/commit conventions.
PRs must keep `pnpm typecheck`, `pnpm lint`, and `pnpm test` green.
