# Design — Migrate Outreach Hub to Azure (Azure-native)

**Date:** 2026-06-23
**Status:** Approved (design); pending spec review → implementation plan
**Author:** Miguel del Amor + Claude

## Context & decision

Everything else at DisplayNote runs in Azure. The app currently depends on
**Supabase** (Postgres + RLS + Auth-as-Entra-broker + Realtime + 5 plpgsql RPCs)
and **Vercel** (hosting + cron). Decision: **move the whole stack into the Azure
tenant**, Azure-native (not self-hosted Supabase).

Key framing decisions (settled in brainstorming):

- **Pre-launch, no production data.** Supabase was never deployed to a prod
  project → no data migration, no cutover, no parallel-run.
- **Build on Azure and launch once.** We never ship to prod on Supabase/Vercel;
  the sales team starts directly on Azure. (Accepts a launch delay for a clean,
  single operational stack.)
- **Single PR.** All phases land in one pull request, structured as one clean
  commit per phase. Risk: a large PR is harder to review — mitigated by
  per-phase commits, full CI, and an adversarial review pass before merge.

## Goals / non-goals

**Goals**
- All runtime + data inside the Azure tenant.
- Preserve the security model: **RLS stays the multi-tenant boundary.**
- Reuse the schema, RLS policies, and the 5 RPCs (they are plain Postgres).
- Keep behaviour parity with the current app (campaigns, contacts, sequences,
  email runner, dialler, admin, unsubscribe).

**Non-goals**
- No feature changes. This is a re-platform, not a rewrite of business logic.
- No data migration (pre-launch).
- Not self-hosting Supabase.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Azure Container Apps** for hosting | App already builds `output: 'standalone'`; ACA is the org standard |
| D2 | **Azure Database for PostgreSQL Flexible Server** | It's Postgres — schema, RLS, plpgsql RPCs port as-is |
| D3 | Data access: **Drizzle + `pg`**, keep existing SQL migrations | TS-first, lightweight, raw-SQL friendly; avoid rewriting migrations |
| D4 | **Preserve RLS** via per-request session GUCs (`SET LOCAL`) | Keep DB-enforced isolation; don't move authz to the app layer |
| D5 | Auth: **Auth.js (NextAuth v5) + Microsoft Entra provider** | Idiomatic Next App Router; manages session + Graph token refresh |
| D6 | Email: delegated token from Auth.js (manual); **MSAL client-credentials app-only** token for the cron mailbox | Cleaner than a stored shared token; fixes the 401 path |
| D7 | Realtime (dialler): **polling** | No new managed service; fine for a handful of reps on scale-to-zero ACA |
| D8 | Cron: **ACA Job** (cron schedule) calling the runner functions directly | No HTTP/secret hop; runs in-cluster |
| D9 | Secrets in **Key Vault**, images in **ACR**, IaC via **Terraform azurerm** | Azure-native ops; replaces vercel.tf/supabase.tf |

## Target architecture

| Layer | Today | Target |
|---|---|---|
| Hosting | Vercel | Azure Container Apps |
| Database | Supabase Postgres | Azure Database for PostgreSQL Flexible Server |
| Auth | Supabase Auth (Entra broker) | Entra direct via Auth.js v5 |
| Email | Graph (Supabase token) | Graph: delegated via Auth.js (+refresh); cron via MSAL app-only |
| Realtime | Supabase Realtime | Polling |
| Cron | Vercel Cron | ACA Job (cron schedule) |
| Secrets | Vercel/Supabase env | Azure Key Vault → ACA secret refs |
| Images | Vercel build | ACR + GitHub Actions build/push |
| IaC | Terraform (vercel+supabase) | Terraform azurerm |
| Telnyx webhook | API route | unchanged |

## Component design

### Data layer (`lib/supabase/*` → `lib/db/*`) — the bulk of the work
- Replace the supabase-js browser/server/service clients with a `pg` pool +
  Drizzle query builder.
- **RLS preservation:** a `withRls(session, fn)` helper opens a transaction,
  runs `SET LOCAL app.user_id = …` / `SET LOCAL app.org_id = …`, executes the
  callback's queries, and commits. The app connects as a **non-superuser role**
  so RLS applies (the table owner/superuser would bypass it).
- A new migration rewrites the RLS helper functions (`current_org_id()`, any
  `auth.uid()`/`auth.jwt()` usage) to read `current_setting('app.org_id', true)`
  etc. instead of Supabase's `auth` schema. Policies themselves are unchanged.
- The **service-role equivalent** (cron, the public `/api/unsubscribe` route)
  uses a privileged path: either a role that bypasses RLS or `withRls` with the
  target org's claims set explicitly from trusted input (the cron's `CRON_ORG_ID`,
  the unsubscribe token's org).
- Rewrite all queries in `lib/supabase/queries.ts` and the data access inside the
  server actions to Drizzle, behind the `withRls` wrapper.
- Migrations: keep the existing `supabase/migrations/*.sql` (plain Postgres); run
  them with a lightweight runner (e.g. a `migrate` step in CI/job), not Drizzle's
  generator.

### Auth (`lib/auth/*`, `app/auth/*`, `lib/supabase/middleware.ts`)
- Auth.js v5 with the Entra provider; its route handler replaces the Supabase
  `auth/callback` exchange. The centralized auth gate we added stays (re-expressed
  against the Auth.js session).
- First-login provisioning of `organizations` + `users` rows in the Auth.js
  `signIn`/`jwt` callback (replaces the current callback logic).
- The session carries `userId` + `orgId` → used to populate the `withRls` GUCs.
- Store the Graph access + refresh tokens (request `offline_access`); refresh on
  expiry — this properly fixes the 401 path we patched earlier.

### Email
- The Graph driver is unchanged. Manual send/scan uses the delegated token from
  the Auth.js session (with refresh). The cron sender uses an **app-only**
  (client-credentials, application `Mail.Send`) token via MSAL for the configured
  mailbox — no stored shared token.

### Realtime (dialler)
- Replace `lib/dialler/amd/realtime.ts` (Supabase channel) and the subscription
  in `components/amd-run.tsx` with polling of the AMD run/row status (server
  action or a small status route) every ~1–2s while a run is active.

### Cron
- An **ACA Job** with a cron schedule runs an entrypoint that calls
  `runSenderAllOrgs` / `scanInboxAllOrgs` directly (no HTTP, no `CRON_SECRET`).
  Same cadence as today (`vercel.json` is removed). The `/api/email/run|scan`
  routes can be retired or kept for manual triggering.

### Hosting / IaC / CI / secrets
- Terraform `azurerm` provisions: Postgres Flexible Server, ACR, ACA environment
  + app, ACA Job, Key Vault. Replaces `infra/vercel.tf` + `infra/supabase.tf`.
- GitHub Actions: build the image → push to ACR → roll a new ACA revision
  (replaces the Vercel Git integration and the infra plan-against-providers flow).
- Secrets live in Key Vault, surfaced to ACA as secret references / env.

## Phasing (commit structure within the single PR)

1. **Foundations (IaC):** Terraform azurerm — Postgres, ACR, ACA app + env, Key
   Vault, ACA Job; a container deploys and connects to Postgres.
2. **Data layer:** Drizzle + `pg`, `withRls`, the RLS-helper migration, rewrite
   queries/actions. *(largest)*
3. **Auth:** Auth.js + Entra, provisioning, middleware gate, RLS claims from
   session, Graph token handling.
4. **Email/cron:** ACA Job entrypoint + MSAL app-only Graph token; re-point the
   Telnyx webhook.
5. **Realtime → polling** (dialler).
6. **Cutover/cleanup:** remove Supabase/Vercel deps + IaC + `vercel.json`, update
   docs, run e2e against Azure, launch.

## Relationship to PR #12

PR #12 (prod-readiness) carries **provider-agnostic** improvements that remain
valuable on Azure: send-window enforcement, the admin gate, the composite FK,
the `logCallOutcome` CAS guard, the delete-row assertions, the unsubscribe
feature, the Graph 401 + DSN-parse work. Its **Vercel/Supabase-specific** parts
(the `vercel.tf`/`supabase.tf` fixes, the Vercel+Supabase deployment runbook)
are superseded by this migration. **Recommendation: merge PR #12 first and base
the Azure work on it**, so the app-level hardening is preserved and this PR
focuses purely on the re-platform. (To confirm with the operator.)

## Testing

- Unit (Vitest) stays; the runner/scanner/Graph tests are provider-agnostic.
- Data layer: tests for `withRls` (claims set/cleared per transaction; a query
  without claims sees nothing) and that RLS still blocks cross-org access.
- Auth: provisioning on first login; session → RLS claims.
- e2e (Playwright) re-pointed at the Azure stack before launch.

## Risks & mitigations

- **Large single PR.** → one clean commit per phase, full CI, adversarial review
  before merge.
- **RLS context bugs** (a query escaping `withRls` runs with no org scope and RLS
  denies everything, or — worse — a privileged path leaks). → centralize all DB
  access through `withRls`; test the deny-by-default behaviour; keep the
  service/privileged path tiny and explicit.
- **Connection pooling** on serverless-ish ACA + Postgres Flexible Server. → use a
  bounded pool / PgBouncer (Flexible Server built-in) sizing for ACA replicas.
- **Graph app-only consent** (application `Mail.Send`) needs admin consent in the
  prod tenant — operator task, same class as the existing delegated consent.

## Out of scope
- Feature changes, data migration, multi-region, self-hosting Supabase.
