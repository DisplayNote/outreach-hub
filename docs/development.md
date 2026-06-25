# Development guide

Common dev scenarios. Local development runs the real app against a throwaway
**Docker Postgres 16 + Mailpit** — no Supabase, no cloud project. Pick the
scenario that matches your task.

## Scenario A — First time on a clean machine

Prerequisites:

- Node 24.13+ (use `nvm install` against `.nvmrc`)
- pnpm 11+ (`npm install -g pnpm@11` or via corepack)
- Docker Desktop (running)
- Git
- Make (Linux/macOS ship it; Windows can use the PowerShell commands below instead)

Setup:

```bash
git clone https://github.com/DisplayNote/outreach-hub.git
cd outreach-hub
pnpm install
cp .env.bootstrap.example .env.bootstrap
# For local dev, fill ONLY the Microsoft values (MS_CLIENT_ID/SECRET/MS_DEV_TENANT_ID);
# they become AZURE_AD_* for the Auth.js Entra provider. The Azure cloud creds are
# needed only for `make bootstrap-prod`.
make bootstrap   # LOCAL: writes .env.local (no cloud anything)
make dev         # docker Postgres + Mailpit → migrate → next dev
```

`make dev` brings up `postgres:16` (host `localhost:5433`, db `outreach`) and
Mailpit, applies the SQL migrations with `node scripts/migrate.mjs`, then starts
`next dev`. Open <http://localhost:3000>.

PowerShell equivalent when GNU Make is unavailable:

```powershell
git clone https://github.com/DisplayNote/outreach-hub.git
Set-Location outreach-hub
pnpm install
Copy-Item .env.bootstrap.example .env.bootstrap
# Fill .env.bootstrap with the Microsoft values.
.\scripts\dev-bootstrap.ps1
.\scripts\dev.ps1
```

## Scenario B — UI-only work (no DB writes)

If you're iterating on layout/components and have the stack up (`make dev`), the
dev sign-in at `/auth/mock` (offered on `/login` because `APP_BASE_URL` is a
loopback host and `AUTH_MOCK_ENABLED=true`) signs you in as a seeded dev user with
no Microsoft round-trip — so every screen is reachable without a live Entra app.

## Scenario C — Dialler work with real Telnyx

You'll need a public tunnel (e.g. ngrok) exposing your local app's Telnyx webhook
route (`<tunnel>/api/telnyx/webhook`) and the Telnyx Call Control Application
pointing at it, plus `TELNYX_*` in `.env.local`. Without them, set
`DIALLER_MOCK_ENABLED=true` for the in-process mock backend (gated to loopback +
non-prod). Webhook signatures are HMAC-verified server-side; never expose the key.

## Scenario D — Email runner with real Graph dev tenant

You need:

- `EMAIL_DRIVER=graph-dev` in `.env.local`
- Admin consent on the sandbox tenant for `Mail.Send` / `Mail.Read` (delegated)
- A signed-in dev user (the Auth.js login stores the delegated Graph token; the
  refresh logic is wired)

Until then, use `EMAIL_DRIVER=mock` (in-memory) or `mailpit` (real SMTP into the
local Web UI at <http://localhost:8025>).

## Microsoft SSO validation

Login is **Auth.js v5 + Microsoft Entra** (not Supabase Auth). Required local app
registration values:

- Redirect URI: `http://localhost:3000/api/auth/callback/microsoft-entra-id`
- Scopes requested: `openid profile email offline_access User.Read Mail.Send Mail.Read`

After the first real login, verify the DB has one linked row in each:
`public.organizations` and `public.users` (created by the `provision_user`
first-login path). Query via any Postgres client against `localhost:5433`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `pnpm dev` / migrate exits with env validation error | `.env.local` missing or incomplete | `make bootstrap`, then check `DATABASE_URL` / `DATABASE_URL_ADMIN` are set. |
| Postgres port conflict on 5433 | another Postgres bound to 5433 | Stop it, or change the host port in `docker-compose.dev.yml`. |
| `docker compose` cannot connect | Docker Desktop is stopped or still starting | Start Docker Desktop, then confirm `docker ps` works. |
| Migrations fail with a TLS error | `PGSSL` unset against local Postgres | Local has no TLS; ensure `PGSSL=disable` (set by `make bootstrap`). |
| OAuth redirect mismatch | Redirect URI not registered in the Microsoft app | Add `http://localhost:3000/api/auth/callback/microsoft-entra-id` to App Registrations → Authentication. |
| Playwright never gets `Ready in` | `next dev` crashed early — check stderr | Run `pnpm dev` directly to see the crash. |
| `pnpm install` complains about ignored build scripts | New native dep added | Add the dep name to `allowBuilds:` in `pnpm-workspace.yaml`. |

## Common commands

```bash
make typecheck   # tsc --noEmit
make lint        # eslint .
make test        # vitest run
make test-e2e    # playwright test (boots its own dev server)
make build       # next build
make db-migrate  # apply SQL migrations (node scripts/migrate.mjs)
make db-reset    # recreate the local pg volume + re-migrate (CAUTION: destroys data)
make db-migration name=add_contacts  # scaffolds a new timestamped migration .sql
make dev-stop    # tears the stack down (keeps the pg volume)
```

## Seeding dev data

`make seed` fills your LOCAL dev DB with a realistic, full-coverage dataset so
every screen has something to work with, and removes the `E2E *` rows that e2e
runs leave behind. It connects as the Postgres superuser (`DATABASE_URL_ADMIN`,
which bypasses RLS) and is **localhost-only** — it refuses to run unless the admin
URL host is a loopback (`127.0.0.1`, `localhost`, or IPv6 `::1`/`[::1]`) — and
**idempotent** (wipe-then-insert scoped to the dev org), so you can re-run it any
time.

Prereqs: just the dev stack running (`make dev`). `make seed` provisions the dev
user + org itself via the `provision_user` RPC, so you don't need to sign in via
`/auth/mock` first. Then:

```bash
make seed         # dataset + best-effort Mailpit reply injection
make seed-inbox   # just re-inject the Mailpit replies
```

What it creates: a template library, three sequences (one multi-step), four
campaigns (one deliberately **unlinked**, to show the queue's "Not linked"
state), 18 contacts spanning every status / sequence position / follow-up
bucket (incl. due-today and overdue), touchpoints, send/reply/bounce history,
suppressions, and tuned per-user goals/dialler settings.

### Testing the inbox

- **Replies (live):** run with `EMAIL_DRIVER=mailpit`, then `make seed-inbox`
  injects reply messages into Mailpit (<http://localhost:8025>). Open the Email
  Queue and click **Scan inbox now** — the scanner correlates each reply to the
  contact by sender address and records it.
- **Bounces (live):** use the in-app **Sim bounce** button on the Email Queue
  (default `mock` driver). The Mailpit path can't carry a recoverable failed
  recipient, so bounces are exercised through the mock driver instead.
- **History (always):** `make seed` also writes past `sent`/`reply`/`bounce`
  `email_events` so Activity, Reports and the pipeline look populated without any
  scanning.
