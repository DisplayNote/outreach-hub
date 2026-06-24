# Architecture

## Stack overview

```
                     ┌───────────────────────────┐
                     │       Microsoft Entra     │
                     │  (OAuth app registration) │
                     └─────────────┬─────────────┘
                                   │ OIDC (Auth.js v5)
                                   ▼
   ┌─────────────┐  HTTPS   ┌────────────────┐   Postgres    ┌──────────────────┐
   │ Azure       │ ◀───────▶│   Next.js 15   │ ◀───────────▶ │ Postgres Flexible│
   │ Container   │          │  (App Router,  │  pg + Drizzle │ Server           │
   │ App         │          │   standalone)  │  withRls() tx │ (RLS via session │
   │ (ACR image, │          │  Server Comps  │  app_user     │  GUCs app.*)     │
   │  MI → KV)   │          │  Route Handlrs │  role         │                  │
   └──────┬──────┘          │  Middleware    │               └──────────────────┘
          │                 └───────┬────────┘
          │ curl /api/email/*       │ EmailDriver
          ▼ (CRON_SECRET)           ▼
   ┌──────────────┐         ┌──────────────┐                 ┌──────────────┐
   │ ACA Jobs     │         │ MS Graph API │                 │   Telnyx     │
   │ send / scan  │         │ Mail.Send /  │                 │  Call Ctrl   │
   │ (cron)       │         │ Mail.Read    │                 │   + AMD      │
   └──────────────┘         └──────────────┘                 └──────────────┘

  Key Vault holds AUTH_SECRET / CRON_SECRET / UNSUBSCRIBE_SECRET / app_user
  password (all Terraform-generated); the app reads them via its managed identity.
```

## Decisions cerradas

| Decision | Why |
|---|---|
| Next.js App Router | Server Components reduce client JS; Server Actions remove an API layer. |
| Azure Container Apps | Runs the standalone Next server with managed-identity access to ACR + Key Vault; scale-to-few, no VM ops. |
| Postgres Flexible Server | Plain managed Postgres — the schema, RLS policies and plpgsql RPCs port verbatim. |
| `pg` + Drizzle behind `withRls(ctx, fn)` | A per-request transaction sets `SET LOCAL app.user_id/app.org_id`; the RLS readers `current_user_id()`/`current_org_id()` resolve from those GUCs, so isolation holds without a Supabase auth schema. |
| Auth.js v5 + Microsoft Entra | One app registration backs both interactive login and the app-only Graph cron token; the signed JWT feeds the RLS context. |
| Microsoft OAuth as the only IdP | We need the app registration for Mail anyway; reusing it for login removes a system. |
| ACA Jobs for cron | Two scheduled jobs curl the app's CRON_SECRET-gated routes — one source of truth for the runner, no second build artifact. |
| Polling (no Realtime) | The dialler polls a server action; removes the Supabase Realtime dependency. |
| pnpm / Vitest + Playwright / Terraform (`azurerm`) | Deterministic installs; fast unit + multi-browser e2e; mature Azure provider. DNS is manual. |
| `EmailDriver` interface | Lets us iterate UI without Graph; switching providers is type-safe (`mock`/`mailpit`/`graph-dev`/`graph-prod`). |
| Single-file dev (`PaulsOutreachHub.html`) → migration target | Battle-tested domain model is preserved — only the platform layer changed. |

## Module map

- `lib/env.ts` — single source of truth for env validation (Zod, server-side). The dev mock gates key off an `APP_BASE_URL` loopback check.
- `lib/db/{client,rls,rls-service,schema,like}.ts` — the `pg` pool + Drizzle, the `withRls`/`withServiceRls` transaction wrappers, the table defs, and `escapeLike`.
- `lib/auth/{config,session,org,admin,provision,graph-tokens}.ts` — Auth.js wiring, session→RLS-context helpers, first-login provisioning, the admin allowlist, and stored Graph tokens.
- `lib/email/` — the `EmailDriver` interface + implementations, the store, and the cron sender/scanner cores.
- `lib/graph/token.ts` — delegated (session) + app-only (MSAL client-credentials) Graph tokens.
- `middleware.ts` — Auth.js middleware (`export { auth as middleware }`); gates everything but the public allowlist.
- `supabase/migrations/*.sql` — schema + RLS + RPCs; the live DB is built from these by `scripts/migrate.mjs`. (Directory name is legacy; the Supabase stack is gone.)
- `Dockerfile` — the standalone Next.js production image (built in ACR by CI).
- `docker-compose.dev.yml` — local Postgres 16 + Mailpit for `make dev`.
- `infra/` — Terraform (`azurerm`): RG, ACR, Postgres, Key Vault, the Container App, and the cron Jobs.

## Phase boundaries

The original phased roadmap lives in [OUTREACH_HUB_EXECUTION_PLAN.md](./OUTREACH_HUB_EXECUTION_PLAN.md);
the Azure migration is tracked in [superpowers/plans/2026-06-23-azure-migration.md](./superpowers/plans/2026-06-23-azure-migration.md).
