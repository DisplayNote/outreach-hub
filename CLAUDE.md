# Outreach Hub — Claude Code project instructions

**Read this first.** This file is the project-local entry point for any Claude
Code session working under `D:/workspace/outreach-hub/` (or wherever the repo
is checked out). It takes precedence over any ancestor `CLAUDE.md`.

## Workflow override — IMPORTANT

The ancestor `D:/workspace/CLAUDE.md` describes a generic AIDLC workflow
(Inception → Construction → Operations phases with `aidlc-docs/` artifacts).
**That workflow does NOT apply here.** Outreach Hub follows its own executable
spec at [docs/OUTREACH_HUB_EXECUTION_PLAN.md](docs/OUTREACH_HUB_EXECUTION_PLAN.md).

Do not create `aidlc-docs/`, do not run AIDLC "stages", do not present
"workspace detection" or "requirements analysis" prompts. Just read the
execution plan and PHASE_0_STATUS.md, then act.

## What this project is

DisplayNote's multi-user outreach platform. Migration target of the legacy
single-file PWA at `legacy/PaulsOutreachHub.html`. Stack:

- **Frontend:** Next.js 15 (App Router), TypeScript strict, Vercel hosting.
- **Backend:** Supabase (Postgres + RLS + Auth + Realtime + Edge Functions + Vault + Storage).
- **Auth:** Microsoft Entra ID via Supabase Auth (multi-tenant).
- **Email:** `EmailDriver` abstraction → `mock` / `mailpit` / `graph-dev` / `graph-prod`.
- **IaC:** Terraform in `infra/` (Supabase + Vercel + Cloudflare DNS).
- **CI/CD:** GitHub Actions (`ci`, `infra`, `db-migrate`, `functions-deploy`).
- **Tests:** Vitest (unit) + Playwright (e2e).

## Current status

- **Phase:** 0 (bootstrap)
- **Status file:** [PHASE_0_STATUS.md](PHASE_0_STATUS.md) — single source of truth for what's done vs blocked.
- **Last commit on main:** see `git log -1`.

§5.5 validations completed credential-free: `git status` clean, typecheck/lint
green, vitest + playwright pass, `next build` succeeds. Items 2 / 6 / 7 / 8 /
9 / 10 are blocked on prerequisites — see PHASE_0_STATUS.md for the table.

## Session start protocol

Every fresh Claude Code session, in order:

1. `cat PHASE_0_STATUS.md` (or Read it). Don't skip — it's the only durable
   handoff between sessions.
2. `git log --oneline -10` and `git status` so you know what landed since last
   time.
3. Re-run prerequisite checks (do not trust the file's "still missing" list):
   ```bash
   test -f .env.bootstrap && echo "1 ✓" || echo "1 ✗ .env.bootstrap"
   terraform -version >/dev/null 2>&1 && echo "2 ✓" || echo "2 ✗ terraform"
   docker ps >/dev/null 2>&1 && echo "3 ✓" || echo "3 ✗ docker"
   git remote -v | grep -q origin && echo "4 ✓" || echo "4 ✗ remote"
   ```
4. If any of 1–4 fails, stop and ask. **Do not start `make bootstrap` or
   `make dev` with partial prerequisites.**
5. If all pass, follow the (a)–(f) sequence in PHASE_0_STATUS.md → "What I
   can do without the four prereqs" section's neighbour table (a) make
   bootstrap, (b) make dev, (c) Task 6 manual OAuth, (d) terraform plan
   (no apply), (e) trivial PR for CI/preview, (f) update PHASE_0_STATUS.md.

## Coding conventions

From spec §7.1 and the four retroactive ADRs in [docs/adr/](docs/adr/):

- **TypeScript** strict, plus `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`. No `@ts-ignore` —
  `@ts-expect-error <reason>` only when truly unavoidable.
- **Imports** via the `@/*` alias for anything inside the repo. No `../../..`
  chains.
- **Server vs client:** follow Next.js App Router conventions. `'use client'`
  only when strictly needed (event handlers, hooks, browser-only APIs).
- **CSS / ambient declarations** go in `global.d.ts`, **not** `next-env.d.ts`
  (Next regenerates that file every dev/build — see ADR 003).
- **New error classes:** forward `cause` to `Error`'s native option, don't
  use parameter-property syntax for that field (ADR 003).
- **Auth-gated server pages:** `export const dynamic = 'force-dynamic';`
  (ADR 004).
- **Branches:** trunk-based. Short branches `feat/<scope>`, `fix/<scope>`,
  `chore/<scope>`, `docs/<scope>`, `refactor/<scope>`, `test/<scope>`,
  `infra/<scope>`. Squash-merge into `main`.
- **Commits:** Conventional Commits. Subject < 72 chars; body wraps at 100.
- **ESLint** is pinned at `^9` due to a 7.37 react-plugin incompatibility
  (ADR 002). Bumping requires verifying `pnpm lint` still runs clean.
- **pnpm native build approval** lives in `pnpm-workspace.yaml#allowBuilds`,
  not `package.json#pnpm` (ADR 001). Adding a dep with a postinstall script
  → add an entry.

## Common commands

```bash
make help                              # list targets
make bootstrap                         # populate .env.local + infra/envs/dev.tfvars from .env.bootstrap
make dev                               # boot Mailpit + Supabase + next dev
make dev-stop                          # tear down
make typecheck                         # tsc --noEmit
make lint                              # eslint .
make test                              # vitest
make test-e2e                          # playwright
make build                             # next build (production)
make db-reset                          # nuke local Supabase data
make db-migration name=<slug>          # scaffold a new migration
```

## Repo layout

```
app/                  Next.js App Router (routes, layouts, server components)
components/ui/        Reusable UI primitives (lands in Phase 1)
lib/
  env.ts              Zod-validated env access
  supabase/           Browser + server clients, SSR middleware helper
  email/              EmailDriver abstraction + mock/mailpit/graph implementations
  auth/               (lands in Phase 1)
supabase/
  migrations/         SQL migrations
  functions/          Deno edge functions
  config.toml         Local Supabase stack config
infra/                Terraform (Supabase + Vercel + Cloudflare)
.github/workflows/    CI/CD pipelines
tests/{unit,e2e}/     Vitest + Playwright tests
scripts/              dev-bootstrap.sh, dev.sh, teardown.sh
docs/
  OUTREACH_HUB_EXECUTION_PLAN.md   Active spec (the source of truth for what to build)
  development.md                   Dev scenarios + troubleshooting
  architecture.md                  ASCII stack diagram + decision rationale
  deployment.md                    Pre-flight + secret rotation
  adr/                             Architecture Decision Records
legacy/               Original PaulsOutreachHub.html + Cloudflare AMD worker (reference only)
PHASE_0_STATUS.md     Phase 0 progress + unblock list (READ EVERY SESSION)
```

## Cross-machine portability

To resume from a different computer running Claude Code:

1. `git clone https://github.com/DisplayNote/outreach-hub.git` (once the
   remote exists — see PHASE_0_STATUS.md prerequisite #4).
2. Install: Node 20.18+, pnpm 11+, Docker Desktop, Terraform CLI, Make.
3. Copy your `.env.bootstrap` from a secure location (1Password / password
   manager). **It is NOT in git** by design.
4. `pnpm install`.
5. Open the repo in Claude Code. The session-start protocol above runs.
6. If all prereqs check, proceed with the (a)–(f) sequence.

The repo is self-describing: PHASE_0_STATUS.md + docs/adr/ + docs/OUTREACH_HUB_EXECUTION_PLAN.md
together carry all the context another Claude Code session needs. No chat
history is required.

## What NOT to do

- Don't follow the parent `D:/workspace/CLAUDE.md` AIDLC workflow.
- Don't create `aidlc-docs/`, `audit.md`, or AIDLC-stage prompts.
- Don't run `make bootstrap` or `make dev` without all four prereqs green.
- Don't run `terraform apply` — `plan` only, per spec §5.4 Task 8.
- Don't commit `.env.bootstrap`, `.env.local`, or `infra/envs/dev.tfvars`
  (all gitignored).
- Don't push to `main` directly — every change goes through a PR.
- Don't edit `next-env.d.ts`; use `global.d.ts` for ambient declarations.
- Don't escalate on ESLint warnings or transient network failures
  (allowed per spec §5.6).
