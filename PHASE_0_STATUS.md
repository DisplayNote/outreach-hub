# Phase 0 status

Source of truth for what landed, what's still blocked, and what's needed to unblock.

**Spec:** [docs/OUTREACH_HUB_EXECUTION_PLAN.md](docs/OUTREACH_HUB_EXECUTION_PLAN.md) §5
**Bootstrap commit:** `83b47dd` — *chore(bootstrap): scaffold Phase 0 platform skeleton*
**Docs backfill commit:** `cd87b9b` — *docs: backfill PHASE_0_STATUS, ADRs 001-004, move plan into docs/*
**Last prerequisite check:** 2026-05-25 — all four prerequisites still failing (see "Prerequisites" section).
**Session protocol:** see [CLAUDE.md](CLAUDE.md) → *Session start protocol*. Don't skip — re-running the
prereq checks each session prevents acting on stale assumptions.

## Mode

Phase 0 was executed in **credential-free mode**: `.env.bootstrap` was never
supplied, so anything that depends on real Supabase / Vercel / Microsoft /
Cloudflare values was deferred. The platform code, configs, infra-as-code, CI
workflows, and tests are all in place; only the credentialed validations are
outstanding.

## §5.5 validation checklist

| # | Criterion | Status | Notes |
|---|---|---|---|
| 1 | `git status` clean | ✅ | Working tree clean since `83b47dd`. |
| 2 | `make clean && make bootstrap && make dev` boots from scratch | ⏸ blocked | Needs `.env.bootstrap` + Docker daemon. |
| 3 | `make typecheck` — 0 errors | ✅ | `tsc --noEmit` clean. |
| 4 | `make lint` — 0 errors | ✅ | 2 stylistic warnings on config files (`import/no-anonymous-default-export`); allowed per §5.6. |
| 5 | `make test` + `make test-e2e` green | ✅ | Vitest 5/5 (2 files), Playwright 1/1. |
| 6 | OAuth flow against sandbox tenant works end-to-end | ⏸ blocked | Needs `.env.bootstrap` with `MS_CLIENT_ID` / `MS_CLIENT_SECRET` / `MS_DEV_TENANT_ID` + admin-consented app registration. |
| 7 | PR with cosmetic change → CI green → Vercel preview deploys | ⏸ blocked | Needs GitHub repo `DisplayNote/outreach-hub` created, origin pushed, and repo secrets per §4.5 configured. |
| 8 | Merge → CI green → Vercel production deploys | ⏸ blocked | Same as #7. |
| 9 | `terraform -chdir=infra plan -var-file=envs/dev.tfvars` → "No changes" (idempotence) | ⏸ blocked | Needs Terraform CLI installed and `infra/envs/dev.tfvars` populated (via `make bootstrap`). |
| 10 | Supabase Studio (prod) shows first user after preview OAuth login | ⏸ blocked | Needs #6 + #7. |

## Prerequisites still missing (re-checked each resume)

Current state as of 2026-05-25 — re-run the checks in CLAUDE.md → *Session start protocol* before
trusting this.

| # | Prerequisite | Last check | How to unblock |
|---|---|---|---|
| 1 | `.env.bootstrap` at repo root with every var from §4.6 | ❌ missing | Complete §4 pre-flight, fill the template at `.env.example`, drop the result at `.env.bootstrap` (gitignored). |
| 2 | `terraform -version` succeeds | ❌ not installed | Windows: `winget install Hashicorp.Terraform`. macOS: `brew install terraform`. Linux: download from hashicorp.com. |
| 3 | `docker ps` succeeds (Docker Desktop running) | ❌ daemon offline | Start Docker Desktop; wait until the whale icon settles. |
| 4 | `git remote -v` shows GitHub origin | ❌ no remote | Create `DisplayNote/outreach-hub` (empty) on GitHub, then `git remote add origin https://github.com/DisplayNote/outreach-hub.git && git push -u origin main`. |
| 5 | GitHub Actions secrets per §4.5 | ⏸ cannot introspect | Set in repo Settings → Secrets and variables → Actions (full list in §4.5). Operator confirms. |

Until 1–4 are all green, no further `make bootstrap` / `make dev` / `terraform plan` / PR validation
can be done. **Do not start the (a)–(f) sequence with partial prerequisites.**

## What's deliberately deferred to later phases

Out of scope for Phase 0 per §5.3 (no action needed now):

- Domain model: `campaigns`, `contacts`, `touchpoints` → Phase 1.
- Real `GraphDriver` implementation → Phase 5 (current `lib/email/graph.ts` is a stub).
- Telnyx client/server code → Phases 3–4.
- Audit log triggers → Phase 6.
- Data migration from `legacy/PaulsOutreachHub.html` → Phase 1.

## File pointers

- Active spec: [docs/OUTREACH_HUB_EXECUTION_PLAN.md](docs/OUTREACH_HUB_EXECUTION_PLAN.md)
- Legacy reference materials: [legacy/](legacy/) (Paul's HTML, the Cloudflare worker, prior handover)
- ADRs: [docs/adr/](docs/adr/)

## Deviations from the spec (see ADRs)

| ADR | Topic |
|---|---|
| [001](docs/adr/001-pnpm-allowbuilds-location.md) | pnpm 11.2 moved native-build approval to `pnpm-workspace.yaml#allowBuilds` |
| [002](docs/adr/002-eslint-version-pin.md) | Pin ESLint to ^9 (eslint-plugin-react 7.37 incompatible with ESLint 10) |
| [003](docs/adr/003-typescript-exact-optional-property-types.md) | Workarounds for `exactOptionalPropertyTypes` + TS 6 strictness |
| [004](docs/adr/004-force-dynamic-home-page.md) | `export const dynamic = 'force-dynamic'` on the auth-gated home page |

Future deviations land in `docs/adr/NNN-short-name.md` using the same pattern.

## Resume sequence (when prerequisites are green)

The (a)–(f) sequence from the operator's resume prompt:

- **(a)** `make bootstrap` — populates `.env.local`, `infra/envs/dev.tfvars`, `infra/envs/prod.tfvars` from `.env.bootstrap`.
- **(b)** `make dev` — boots Mailpit + Supabase + next dev. Confirm all four URLs respond:
  http://localhost:3000, http://localhost:54321 (Supabase API), http://localhost:54323 (Studio), http://localhost:8025 (Mailpit).
- **(c)** Task 6 manual OAuth validation per spec §5.4 Task 6 — operator drives the browser; the
  assistant walks them through steps 1–6 (sign-in flow → Studio check that `auth.users`, `public.organizations`,
  `public.users` each have 1 row linked).
- **(d)** `terraform -chdir=infra init` then `terraform -chdir=infra plan -var-file=envs/dev.tfvars`. Report
  the plan output. **Do NOT run `terraform apply`** — Mike approves it manually the first time.
- **(e)** Push a trivial commit on a branch (`chore/ci-smoke`), open a PR. Confirm CI runs and goes
  green; confirm a Vercel preview URL is generated and accessible. This validates items §5.5 #7 and #8.
- **(f)** Update this file: flip the ⏸ items to ✅ with their verification timestamps. Commit as
  `docs: close out Phase 0 §5.5 validations`.

## Cross-machine portability

To resume from a different computer:

1. Clone the repo (once the GitHub remote exists).
2. Install: Node 20.18+, pnpm 11+, Docker Desktop, Terraform CLI, Make.
3. Copy `.env.bootstrap` from your secure store (1Password / password manager) — it's NOT in git.
4. `pnpm install`.
5. Open the repo in Claude Code. Follow CLAUDE.md → *Session start protocol*.

The repo is self-describing: this file + [CLAUDE.md](CLAUDE.md) + [docs/adr/](docs/adr/)
+ [docs/OUTREACH_HUB_EXECUTION_PLAN.md](docs/OUTREACH_HUB_EXECUTION_PLAN.md) carry every piece of
context another session needs. No chat history is required.
