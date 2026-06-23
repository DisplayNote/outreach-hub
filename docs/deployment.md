# Deployment

How to take Outreach Hub to production on **Vercel + Supabase Cloud** with
Microsoft Entra SSO, and how to verify a build locally with Docker first.

> Current target: keep the managed stack (Vercel for app hosting + Supabase
> Cloud for Postgres/RLS/Auth/Realtime). A future move of app hosting to Azure
> Container Apps is possible — the app already builds `output: 'standalone'` and
> runs as a container — but is deliberately deferred until the product is live.

---

## 0. Verify the production build locally with Docker (do this first)

This runs the **same `Dockerfile` image** that production uses, against a local
Supabase stack and Mailpit, so you can smoke-test login + sending before touching
any cloud project:

```bash
make bootstrap      # writes .env.local from .env.bootstrap (needs only the MS_* values)
make dev-docker     # builds the prod container + starts Supabase (CLI) + Mailpit
```

Then at <http://localhost:3000>:

1. Sign in with Entra (mock auth is only available on the local stack).
2. Click around the app; confirm data loads.
3. Send a test sequence email with `EMAIL_DRIVER=mailpit` and confirm it lands in
   Mailpit at <http://localhost:8025>.

If that works, the artifact is good. `make dev-stop` tears it down.

---

## 1. Supabase Cloud (production project)

1. Create one Supabase project in an **EU/UK region** (data residency). Record:
   `project-ref`, `anon` key, `service_role` key, DB password.
2. Apply the schema — the 6 migrations bring tables, **RLS policies**, and the 5
   Postgres RPCs the email runner depends on:
   ```bash
   pnpm exec supabase link --project-ref <PROJECT_REF>
   pnpm exec supabase db push --linked
   ```
   Production migrations are **manual on purpose** (no auto-apply pipeline yet).
   Re-run `db push --linked` whenever `supabase/migrations/**` changes on `main`.
3. **Do not** run the dev seed against production (`make seed` is local-only).

## 2. Microsoft Entra ID + Supabase Auth

The SSO app registration already exists; wire it to Supabase:

1. **Supabase → Authentication → Providers → Azure:** set `client_id`,
   `client_secret`, and your `tenant`.
2. **Entra → App registration → Authentication → Redirect URIs:** add Supabase's
   callback `https://<PROJECT_REF>.supabase.co/auth/v1/callback`.
3. **Supabase → Authentication → URL Configuration:** set `Site URL` to the
   Vercel production domain and add it to the redirect allow-list.
4. **API permissions (delegated):** `openid email profile offline_access User.Read`
   **plus** `Mail.Send` and `Mail.Read` (the Graph email driver sends as the
   signed-in user via their delegated token). Grant **admin consent** on the
   production tenant — without it, real sending fails even though login works.

## 3. Vercel project

Connect the GitHub repo with production branch `main` (preview deploys are
disabled by design — there is no non-prod backend). Set **Production** env vars:

| Variable | Value / notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<PROJECT_REF>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key — **sensitive**; used only by the cron route |
| `EMAIL_DRIVER` | `graph-prod` ⚠️ defaults to `mock` if unset → silently sends nothing real |
| `MS_CLIENT_ID` / `MS_CLIENT_SECRET` | Entra app; secret is **sensitive** |
| `CRON_SECRET` | strong random string; gates `/api/email/run` + `/api/email/scan` |
| `CRON_ORG_ID` | UUID of the org whose mailbox sends ⚠️ unset → the cron **throws** in prod (by design, not a silent no-op) |
| `CRON_SENDER_EMAIL` | sender mailbox, unless the org sets `settings.senderEmail` |
| `ADMIN_EMAIL_ALLOWLIST` | comma-separated admin emails; unset → `/admin` 404s for everyone |
| `APP_BASE_URL` | the app's public origin (e.g. `https://outreach.displaynote.com`); used to build absolute unsubscribe links |
| `UNSUBSCRIBE_SECRET` | strong random string; HMAC-signs unsubscribe tokens. **Set both this and `APP_BASE_URL`** or outbound mail ships without an unsubscribe link/header (not compliant for cold outreach) |

**Node version:** the project runs on Node **24.x**, pinned by
`package.json#engines` (`>=24.13`) and the `Dockerfile`. The Vercel Terraform
provider only accepts up to `22.x` for the project setting, so `infra/vercel.tf`
sets `22.x` and the `engines` field overrides it up to 24 at build/runtime.
Confirm in the Vercel build log (`node -v`) after the first deploy.

### Scheduled sending (Vercel Cron — works out of the box)

`vercel.json` declares the schedules and Vercel sends
`Authorization: Bearer $CRON_SECRET` automatically:

| Route | Schedule (UTC) | Purpose |
|---|---|---|
| `/api/email/run` | `15 9 * * 1-5` | Send due sequence emails (weekdays 09:15) |
| `/api/email/scan` | `*/30 7-18 * * 1-5` | Poll inbox for replies/bounces |

`authorizeCron` **fails closed**: if `CRON_SECRET` is unset the route returns 401
and sends nothing, rather than running unauthenticated.

## 4. First deploy & safe email start

1. Merge to `main` → Vercel deploys to production.
2. In **`/admin`**, start conservatively:
   - `seqDailyCap` ≈ **10–15** for the first week (warm-up), raise later.
   - Optionally set the **send window** (UK hours) — it now hard-gates both the
     scheduled run and "Run sender now"; leave blank for no time-of-day limit.
3. Confirm the cron jobs are listed under Vercel → Project → Cron Jobs.

## 5. Production smoke test

1. Sign in with Entra; confirm one row each in `auth.users`, `public.organizations`,
   `public.users` (Supabase Studio).
2. From the UI, run **"Run sender now" in dry-run** to preview recipients without
   sending.
3. Trigger the real cron path manually to validate the Graph token/scopes:
   ```bash
   curl -i -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/email/run
   ```
   Expect `200 {"ok":true,...}`. A `500` means per-contact send failures (most
   commonly missing/expired Graph consent) — check the response body.

### Emergency stop

Set `seqDailyCap = 0` in `/admin` → the runner sends zero, on both the cron and
manual paths, immediately. (No deploy needed.)

---

## CI/CD

| Workflow | Triggers | What it does |
|---|---|---|
| `ci.yml` | PRs + push to `main` | Typecheck, lint, unit tests, build. E2E on `main` push. |
| `infra.yml` | `infra/**` changes | `terraform fmt -check`, `init`, `validate`, `plan`. `apply` is `workflow_dispatch`-gated. |
| `db-migrate.yml` | `supabase/migrations/**` on `main` | `supabase db push --linked`. |
| `functions-deploy.yml` | `supabase/functions/**` on `main` | Deploys changed edge functions. |

Vercel deploys via the Git integration: every `main` commit deploys to production.
Production DB migrations are run by hand (see §1) and noted in the PR that adds them.

## Secret rotation

`MS_CLIENT_SECRET` expires in 24 months. Rotation:

1. Create a new secret in Entra → Certificates & secrets.
2. Update it in: GitHub Actions secrets, Vercel env vars (production), the Supabase
   Azure provider config, and local `.env.bootstrap` (`make bootstrap` regenerates
   `.env.local` / `infra/envs/*.tfvars`).
3. Verify a fresh OAuth login (locally, then production).
4. Delete the previous secret in Entra.

`SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `SUPABASE_ACCESS_TOKEN`, and
`VERCEL_TOKEN` follow the same "create new → update everywhere → verify → delete
old" sequence.

## Terraform state

State is **local** for now (`infra/terraform.tfstate`, gitignored) — acceptable
with a single operator. Move to a remote backend (Terraform Cloud or S3 + lock)
before a second person touches infra.
