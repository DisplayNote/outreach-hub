# Phase 0 status

Source of truth for what landed, what's still blocked, and what's needed to unblock.

**Spec:** [docs/OUTREACH_HUB_EXECUTION_PLAN.md](docs/OUTREACH_HUB_EXECUTION_PLAN.md) §5
**Bootstrap commit:** `83b47dd` — *chore(bootstrap): scaffold Phase 0 platform skeleton*
**Docs backfill commit:** `cd87b9b` — *docs: backfill PHASE_0_STATUS, ADRs 001-004, move plan into docs/*
**Last prerequisite check:** 2026-05-29 08:54 +02:00 — Docker reachable, GitHub remote present;
Make and Terraform still missing. Real `.env*` files were not inspected.
**Session protocol:** see [CLAUDE.md](CLAUDE.md) → *Session start protocol*. Don't skip — re-running the
prereq checks each session prevents acting on stale assumptions.

## Mode

Phase 0 was executed in **credential-safe mode**: real `.env*` files are operator-only and were
not inspected. Anything that depends on real Supabase / Vercel / Microsoft / Cloudflare values
must be run by the operator or with a safe process environment. The platform code, configs,
infra-as-code, CI workflows, Docker image, and tests are in place; credentialed validations are
still outstanding.

## §5.5 validation checklist

| # | Criterion | Status | Notes |
|---|---|---|---|
| 1 | `git status` clean | ⏳ in progress | Working branch `docker-azure-sso-readiness` has uncommitted Docker/readiness changes. |
| 2 | `make clean && make bootstrap && make dev` boots from scratch | ⏸ blocked | Make unavailable on PATH; real `.env*` files are operator-only. Use PowerShell script equivalents. |
| 3 | `make typecheck` — 0 errors | ✅ | `pnpm typecheck` passed 2026-05-29 00:19 +02:00. |
| 4 | `make lint` — 0 errors | ✅ | `pnpm lint` passed 2026-05-29 00:19 +02:00 with the 2 known stylistic warnings on config files. |
| 5 | `make test` + `make test-e2e` green | ⏳ partial | `npm test` passed 8/8 on 2026-05-29 00:19 +02:00. E2E not rerun in this secret-safe pass. |
| 6 | OAuth flow against sandbox tenant works end-to-end | ⏸ blocked | Needs operator-run local SSO with real Microsoft app values; assistant must not inspect real `.env*` files. |
| 7 | PR with cosmetic change → CI green → Vercel preview deploys | ⏸ blocked | GitHub remote exists; PR/Vercel preview still needs push and repo secrets. |
| 8 | Merge → CI green → Vercel production deploys | ⏸ blocked | Same as #7. |
| 9 | `terraform -chdir=infra plan -var-file=envs/dev.tfvars` → "No changes" (idempotence) | ⏸ blocked | Terraform CLI is not installed on PATH; real tfvars are operator-only. |
| 10 | Supabase Studio (prod) shows first user after preview OAuth login | ⏸ blocked | Needs #6 + #7. |

## Docker readiness validation

Non-secret Docker verification completed on 2026-05-29 08:54 +02:00:

- `docker build --build-arg NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key -t outreach-hub:local-test .` passed.
- Temporary container smoke test passed: `http://localhost:3005/login` returned HTTP 200.
- The smoke test used placeholder env values and did not inspect real `.env*` files.

## Prerequisites still missing (re-checked each resume)

Current state as of 2026-05-29 — re-run the checks in CLAUDE.md → *Session start protocol* before
trusting this.

| # | Prerequisite | Last check | How to unblock |
|---|---|---|---|
| 1 | `.env.bootstrap` at repo root with every var from §4.6 | ⏸ not inspected | Real `.env*` files are operator-only. Start from `.env.bootstrap.example`; do not ask assistants to read it. |
| 2 | `terraform -version` succeeds | ❌ not installed | Windows: `winget install Hashicorp.Terraform`. macOS: `brew install terraform`. Linux: download from hashicorp.com. |
| 3 | `docker ps` succeeds (Docker Desktop running) | ✅ available | `docker ps` succeeded 2026-05-29 08:54 +02:00. |
| 4 | `git remote -v` shows GitHub origin | ✅ present | `origin git@github.com:DisplayNote/outreach-hub.git`. |
| 5 | Make available on PATH | ❌ not installed | Use PowerShell equivalents in `docs/development.md` or install Make. |
| 6 | GitHub Actions secrets per §4.5 | ⏸ cannot introspect | Set in repo Settings → Secrets and variables → Actions (full list in §4.5). Operator confirms. |

Until the credential, Terraform, Docker, Git remote, and GitHub secret prerequisites are green,
do not run the full (a)–(f) validation sequence.

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
| [005](docs/adr/005-node-24-runtime-baseline.md) | Node 24.13 baseline for pnpm 11.2.2 and Docker parity |

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
2. Install: Node 24.13+, pnpm 11+, Docker Desktop, Terraform CLI, Make or PowerShell equivalents.
3. Copy `.env.bootstrap` from your secure store (1Password / password manager) — it's NOT in git.
4. `pnpm install`.
5. Open the repo in Claude Code. Follow CLAUDE.md → *Session start protocol*.

The repo is self-describing: this file + [CLAUDE.md](CLAUDE.md) + [docs/adr/](docs/adr/)
+ [docs/OUTREACH_HUB_EXECUTION_PLAN.md](docs/OUTREACH_HUB_EXECUTION_PLAN.md) carry every piece of
context another session needs. No chat history is required.
