# Deployment

## Pre-flight checklist (one-time, by an operator with admin access)

Detailed steps live in §4 of [OUTREACH_HUB_EXECUTION_PLAN.md](./OUTREACH_HUB_EXECUTION_PLAN.md).
Short version:

1. **Accounts:** GitHub repo, two Supabase projects (`dev`, `prod`), Vercel project,
   Cloudflare zone for `displaynote.com`, Telnyx (for Phase 3+).
2. **Microsoft App Registration** in the sandbox tenant - multi-tenant, redirect URIs for local +
   both Supabase projects. Local Phase 0 login requests `email openid profile User.Read
   offline_access`; delegated Graph send/read scopes land in Phase 5. Grant admin consent on the
   sandbox. File a ticket for the prod tenant in parallel (Phase 5 needs it).
3. **Tokens:** Supabase PAT, Vercel PAT, Cloudflare API token (scope `Zone.DNS:Edit`).
4. **GitHub Secrets** (Settings → Secrets and variables → Actions) — listed in §4.5 of the plan.
5. **`.env.bootstrap`** locally (gitignored) with the same values for `make bootstrap`.
   Start from `.env.bootstrap.example`.

Secret handling rule: do not paste, print, or ask an assistant to inspect real `.env*` files.
Use the committed examples for review; let local scripts consume real env files on the operator's
machine.

## CI/CD

| Workflow | Triggers | What it does |
|---|---|---|
| `ci.yml` | PRs + push to `main` | Typecheck, lint, unit tests, build. E2E only on `main` push. |
| `infra.yml` | `infra/**` changes | `terraform fmt -check`, `init`, `validate`, `plan`. `apply` is `workflow_dispatch`-gated. |
| `db-migrate.yml` | `supabase/migrations/**` changes on `main` | `supabase db push --linked` against the dev project. |
| `functions-deploy.yml` | `supabase/functions/**` changes on `main` | Deploys each changed function to the dev project. |

Production migrations are deliberately **not** automatic. Phase 7 introduces a separate
`db-migrate-prod.yml` with a manual gate. Until then, prod migrations are run by hand and
recorded in `aidlc-docs/audit.md`.

Vercel deployments happen via the Git integration: every PR gets a preview URL, every `main`
commit deploys to production.

## Secret rotation

`MS_CLIENT_SECRET` expires in 24 months (see §4.2 of the plan). Rotation:

1. Create a new secret in Microsoft App Registrations → Certificates & secrets.
2. Update `MS_CLIENT_SECRET` in:
   - GitHub Actions secrets
   - Vercel project env vars (production + preview + development)
   - Local `.env.bootstrap` (then `make bootstrap` to regenerate `.env.local` / `infra/envs/*.tfvars`)
3. `terraform -chdir=infra apply -var-file=envs/dev.tfvars` to push the new secret to Supabase auth settings.
4. Verify a fresh OAuth login in dev before pushing prod.
5. Delete the previous secret in Microsoft.

Other rotations (`SUPABASE_ACCESS_TOKEN`, `VERCEL_TOKEN`, `CLOUDFLARE_API_TOKEN`) follow the same
"create new → update everywhere → verify → delete old" sequence.

## State file

Terraform state is **local** for Phase 0 (`infra/terraform.tfstate`, gitignored). This is acceptable
with one operator. Migrating to a remote backend (Terraform Cloud or S3 + DynamoDB lock) is a
Phase 7 task before a second person touches infra.
