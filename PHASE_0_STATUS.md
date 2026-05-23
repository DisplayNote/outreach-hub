# Phase 0 status

Source of truth for what landed, what's still blocked, and what's needed to unblock.

**Spec:** [docs/OUTREACH_HUB_EXECUTION_PLAN.md](docs/OUTREACH_HUB_EXECUTION_PLAN.md) §5
**Bootstrap commit:** `83b47dd` — *chore(bootstrap): scaffold Phase 0 platform skeleton*

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

1. **`.env.bootstrap`** at the repo root with every variable from §4.6.
2. **Terraform CLI** installed (`winget install Hashicorp.Terraform` on Windows).
3. **Docker Desktop** running (`docker ps` must succeed).
4. **GitHub remote**: repo `DisplayNote/outreach-hub` created, `git remote add origin …`, `git push -u origin main`.
5. **GitHub Actions secrets** per §4.5 configured (cannot be introspected from the CLI — operator confirms).

Until 1–4 are all green, no further `make bootstrap` / `make dev` / `terraform plan` / PR validation can be done.

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
