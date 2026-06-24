# Deployment

How to take Outreach Hub to production on **Azure** — Container Apps for the app,
Azure Database for PostgreSQL Flexible Server for data, Microsoft Entra SSO via
Auth.js, with secrets in Key Vault, the image in ACR, and scheduled email as ACA
Jobs — and how to verify a build locally first.

> Stack: the app runs as a container (`output: 'standalone'`) on **Azure
> Container Apps**, talks to **Postgres Flexible Server** as the non-owner role
> `app_user` (so the RLS policies apply), authenticates users with **Auth.js v5
> + Microsoft Entra ID**, and sends/reads mail through Microsoft Graph. There is
> no Supabase and no Vercel.

---

## 0. Verify locally first (Docker Postgres + Mailpit)

Local dev runs the real app against a throwaway Postgres and Mailpit — no cloud
project needed:

```bash
make bootstrap   # writes .env.local from .env.bootstrap (needs only the MS_* values)
make dev         # postgres:16 + Mailpit (docker compose) → migrate → next dev
```

Then at <http://localhost:3000>:

1. Sign in (the dev `/auth/mock` sign-in is available because `APP_BASE_URL` is a
   loopback host and `AUTH_MOCK_ENABLED=true`; never reachable in production).
2. `make seed` for a full-coverage dataset; click around and confirm data loads.
3. Send a sequence email with `EMAIL_DRIVER=mailpit` and confirm it lands in
   Mailpit at <http://localhost:8025>.

`make dev-stop` tears it down (`make dev-stop` then `-v` wipes the pg volume; or
`make db-reset` to recreate + re-migrate).

---

## 1. Provision the Azure stack (Terraform)

`infra/` is `azurerm` (+ `random`). It creates: a resource group, ACR, Postgres
Flexible Server + database `outreach`, Key Vault, the Container Apps Environment +
Log Analytics, the app Container App, and the two cron Jobs. It also **generates**
`AUTH_SECRET`, `CRON_SECRET`, `UNSUBSCRIBE_SECRET`, and the `app_user` DB password
as `random_password` and stores them in Key Vault (never hand-set, never in git).

```bash
make bootstrap-prod   # writes infra/envs/prod.tfvars from .env.bootstrap (Azure creds)
terraform -chdir=infra init
terraform -chdir=infra plan  -var-file=envs/prod.tfvars
terraform -chdir=infra apply -var-file=envs/prod.tfvars
```

Required tfvars (see `infra/envs/prod.tfvars.example`): `azure_subscription_id`,
`azure_tenant_id`, `pg_admin_login`/`pg_admin_password`, `azure_ad_client_id`/
`_secret`/`_tenant_id`, `cron_org_id`, `cron_sender_email`, and optionally
`admin_email_allowlist`, `app_subdomain`, `container_image`, `telnyx_*`.

> First apply uses the `container_image` default (`:latest`) as a placeholder; CI
> repoints it to the freshly built digest on the next push (see §3). Because the
> app's Key-Vault-referenced secrets resolve only after its managed identity gets
> "Key Vault Secrets User", the first revision may re-provision once the role
> propagates — this is the documented trade-off of a system-assigned identity.

## 2. Apply the database schema

Migrations run as the **server admin** (so they can manage roles/policies); the
runner also (re)asserts the `app_user` grants and sets its password from Key
Vault on every run. Manual / `workflow_dispatch` only (no auto-apply on push):

```bash
# Locally against prod, or via the DB Migrate workflow:
NODE_ENV=production \
DATABASE_URL_ADMIN='postgres://<admin>@psql-outreach-prod.postgres.database.azure.com:5432/outreach?sslmode=require' \
APP_USER_PASSWORD='<app-user-password from Key Vault>' \
  node scripts/migrate.mjs
```

The migrations bring the tables, **RLS policies** (re-sourced from the session
GUCs `app.user_id` / `app.org_id`), the `provision_user` RPC, and the email
runner's RPCs. **Do not** run the dev seed against production (`make seed` is
loopback-guarded).

## 3. Image build + deploy (CI, Azure OIDC)

`deploy.yml` runs on push to `main`: `az acr build` builds the `Dockerfile` image
in ACR, then `az containerapp update` rolls the app **and** both cron Jobs onto
the new immutable digest. It authenticates with **Azure OIDC** (`azure/login@v2`,
federated credential) — no stored cloud password. Required repo secrets:
`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` (plus the `TF_VAR_*`
and migrate secrets for `infra.yml` / `db-migrate.yml`).

> **Ordering — migrate before a schema-affecting deploy.** `deploy.yml` rolls the
> app image immediately on push to `main`, but migrations are a separate
> manual/`workflow_dispatch` job (`db-migrate.yml`). When a change depends on a
> new migration, run **DB Migrate first** (or in the same window), then let the
> deploy land — otherwise the new code briefly runs against the old schema. The
> cron Jobs are **not** re-imaged by deploy (Terraform owns their stock curl
> image); they only POST the app's routes.

## 4. Microsoft Entra ID app registration

One app registration backs both interactive sign-in (Auth.js delegated) and the
cron app-only Graph token (MSAL client credentials):

1. **Redirect URI:** `https://<app-domain>/api/auth/callback/microsoft-entra-id`.
2. **Delegated** permissions: `openid email profile offline_access User.Read`
   **plus** `Mail.Send` and `Mail.Read` (the interactive Graph driver sends as the
   signed-in user).
3. **Application** permissions: `Mail.Send` and `Mail.Read` (the scheduled cron
   sender/scanner has no user context and uses an app-only token).
4. **Grant admin consent** on the production tenant for BOTH the delegated and the
   application permissions — without it, real sending fails even though login works.
5. The issuer is **tenant-pinned** (`AZURE_AD_TENANT_ID`), not `common`; the app
   throws at boot in production if the tenant id is unset.

## 5. App configuration (set by Terraform on the Container App)

| Variable | Source |
|---|---|
| `DATABASE_URL` | composed from `app_user` + the Key-Vault password + the PG FQDN, `sslmode=require` |
| `AUTH_SECRET` | Key Vault (generated) — signs the Auth.js session JWT the RLS context trusts |
| `AZURE_AD_CLIENT_ID` / `_SECRET` / `_TENANT_ID` | tfvars (`_SECRET` via a Container App secret) |
| `EMAIL_DRIVER` | `graph-prod` (hard-set) |
| `CRON_SECRET` | Key Vault (generated) — gates `/api/email/run` + `/api/email/scan`, and the cron Jobs send it |
| `CRON_ORG_ID` | tfvars — the single org whose mailbox the cron serves (unset → cron throws in prod, by design) |
| `CRON_SENDER_EMAIL` | tfvars — sender mailbox unless the org sets `settings.senderEmail` |
| `ADMIN_EMAIL_ALLOWLIST` | tfvars — comma-separated; unset → `/admin` 404s for everyone |
| `APP_BASE_URL` | derived from `app_subdomain` — public origin for absolute unsubscribe links |
| `UNSUBSCRIBE_SECRET` | Key Vault (generated) — HMAC-signs unsubscribe tokens |
| `TELNYX_*` | tfvars (optional) — AMD dialler |

### Scheduled sending (ACA Jobs)

Two `azurerm_container_app_job`s curl the app's CRON_SECRET-gated routes against
the app's ingress FQDN (`local.app_internal_url`, wired from the app resource — a
precondition refuses to apply against a loopback host):

| Job | Schedule (UTC) | Route |
|---|---|---|
| `caj-outreach-email-send-prod` | `15 9 * * 1-5` | `POST /api/email/run` |
| `caj-outreach-email-scan-prod` | `*/30 7-18 * * 1-5` | `POST /api/email/scan` |

`authorizeCron` **fails closed**: if `CRON_SECRET` is unset the route returns 401.

## 6. DNS (manual)

DNS is outside Terraform. After `apply`, point a CNAME for `<app_subdomain>` at the
Container App ingress FQDN (output `app_ingress_fqdn`), and add the mail records
(SPF / DKIM / DMARC) for the sending domain by hand.

## 7. Production smoke test

1. Sign in with Entra; confirm one row each in `public.organizations` and
   `public.users` (the `provision_user` first-login path).
2. From the UI, run **"Run sender now" in dry-run** to preview recipients.
3. Validate the Graph token/scopes via the real cron path:
   ```bash
   curl -i -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/email/run
   ```
   Expect `200 {"ok":true,...}`. A `500` is per-contact send failures (most
   commonly missing/expired Graph consent) — check the body.

### Emergency stop

Set `seqDailyCap = 0` in `/admin` → the runner sends zero on both the cron and
manual paths immediately (no deploy needed).

---

## CI/CD

| Workflow | Triggers | What it does |
|---|---|---|
| `ci.yml` | PRs + push to `main` | Typecheck, lint, unit tests, build. E2E on `main` push (Postgres service container). |
| `infra.yml` | `infra/**` changes | `terraform fmt -check`, `init`, `validate`, `plan` (Azure OIDC). `apply` is `workflow_dispatch`-gated. |
| `deploy.yml` | push to `main` (app code) | `az acr build` → `az containerapp update` for the app + cron Jobs (Azure OIDC). |
| `db-migrate.yml` | `workflow_dispatch` | `node scripts/migrate.mjs` against prod Postgres. Manual + confirmation-gated. |

## Secret rotation

- **`AZURE_AD_CLIENT_SECRET`** (expires ≤24 months): create a new secret in Entra →
  update the `azure_ad_client_secret` tfvar + the GitHub `AZURE_AD_CLIENT_SECRET`
  secret → `terraform apply` → verify a fresh login → delete the old secret.
- **`AUTH_SECRET` / `CRON_SECRET` / `UNSUBSCRIBE_SECRET` / `app_user` password:**
  `terraform taint` the relevant `random_password` and `apply` — Terraform rotates
  the Key Vault secret and the app (and migration runner) pick up the new value.
- **`pg_admin_password`:** rotate the tfvar + `apply`.

## Terraform state

State is **local** for now (`infra/terraform.tfstate`, gitignored) — acceptable
with a single operator. Move to a remote backend (Terraform Cloud, or Azure
Storage + state locking) before a second person touches infra.
