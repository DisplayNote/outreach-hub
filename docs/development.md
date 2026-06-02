# Development guide

Common dev scenarios. Pick the one that matches your task.

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
cp .env.bootstrap.example .env.bootstrap
# For local dev, fill ONLY the Microsoft values (MS_CLIENT_ID/SECRET/TENANT).
# The cloud creds (Supabase/Vercel) are needed only for `make bootstrap-prod`.
make bootstrap   # LOCAL: writes .env.local (no Supabase cloud / Vercel needed)
make dev         # Mailpit + Supabase (local CLI stack) + Next.js
```

To generate the prod cloud Terraform variables later: `make bootstrap-prod`
(this needs the Supabase/Vercel creds in `.env.bootstrap`).

PowerShell equivalent when GNU Make is unavailable:

```powershell
git clone https://github.com/DisplayNote/outreach-hub.git
Set-Location outreach-hub
Copy-Item .env.bootstrap.example .env.bootstrap
# Fill .env.bootstrap with the values from section 4.6 of the execution plan.
.\scripts\dev-bootstrap.ps1
.\scripts\dev.ps1
```

Open http://localhost:3000.

## Scenario A2 — Full Docker app runtime

This path runs the production-style Next.js standalone image locally while keeping Supabase under
the Supabase CLI. It does not hand-maintain Supabase's internal Docker services.

```bash
make bootstrap
make dev-docker
```

PowerShell:

```powershell
.\scripts\dev-bootstrap.ps1
.\scripts\dev-docker.ps1
```

Runtime details:

- App container: http://localhost:3000
- Supabase API, started by `pnpm exec supabase start`: http://localhost:54321
- Supabase Studio: http://localhost:54323
- Mailpit SMTP/UI: `localhost:1025`, http://localhost:8025
- Browser Supabase URL stays `http://localhost:54321`.
- Server-side Supabase calls inside the app container use `SUPABASE_INTERNAL_URL`, defaulting to
  `http://host.docker.internal:54321` in `docker-compose.full.yml`.

## Scenario B — UI-only work (no auth, no DB writes)

If you're iterating on layout/components and don't need a live database:

```bash
docker compose -f docker-compose.dev.yml up -d  # just Mailpit for any outbound email
pnpm dev
```

This boots only Next. `/login` renders; clicking *Sign in with Microsoft* will fail (no Supabase),
but every other client component is testable. Use Storybook (lands in Phase 1) for component
isolation.

## Scenario C — Dialler work with real Telnyx

(Lands in Phase 3.) You'll need:

- An ngrok (or equivalent) tunnel exposing your local Supabase Edge Functions at a stable URL
  (`make tunnel` once `OUTREACH_DEV_TUNNEL_URL` is set in `.env.local`)
- Telnyx Call Control Application's webhook pointing at `<tunnel>/functions/v1/telnyx-webhook`
- `pnpm exec supabase functions serve --env-file .env.local`

Webhook signatures are HMAC-verified server-side; do not expose the shared secret.

## Scenario D — Email runner with real Graph dev tenant

(Lands in Phase 5.) You need:

- `EMAIL_DRIVER=graph-dev` in `.env.local`
- Admin consent on the sandbox tenant for `Mail.Send` / `Mail.Read`
- An access token cached for your dev user (the OAuth flow stores it; Phase 5 will wire the
  refresh logic)

Until then, use `EMAIL_DRIVER=mock` (in-memory) or `mailpit` (real SMTP into the local Web UI).

## Microsoft SSO validation

For local/dev readiness, Microsoft SSO means identity login through Supabase Auth, not delegated
Graph email send/read.

Required local app registration values:

- Supabase provider redirect URI: `http://localhost:54321/auth/v1/callback`
- App callback: `http://localhost:3000/auth/callback`
- Scopes requested by the app today: `email openid profile User.Read offline_access`

After the first local login, verify Supabase Studio has one linked row in each table:
`auth.users`, `public.organizations`, and `public.users`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `supabase start` fails with port conflict | 54321/54322/54323 in use | Stop the conflicting service or change the port in `supabase/config.toml`. |
| `pnpm dev` exits with env validation error | `.env.local` missing or incomplete | `make bootstrap` or `cp .env.example .env.local` then fill in. |
| App container cannot reach Supabase | Container is trying to use browser `localhost` internally | Use `make dev-docker`; it sets `SUPABASE_INTERNAL_URL=http://host.docker.internal:54321`. |
| `docker compose` cannot connect | Docker Desktop is stopped or still starting | Start Docker Desktop, then confirm `docker ps` works. |
| OAuth redirect mismatch | Redirect URI not registered in the Microsoft app | Add the URI to App Registrations → Authentication. |
| Playwright never gets `Ready in` | `next dev` crashed early — check stderr | Run `pnpm dev` directly to see the crash. |
| `pnpm install` complains about ignored build scripts | New native dep added | Add the dep name to `allowBuilds:` in `pnpm-workspace.yaml`. |

## Common commands

```bash
make typecheck   # tsc --noEmit
make lint        # eslint .
make test        # vitest run
make test-e2e    # playwright test (boots its own dev server)
make build       # next build
make db-reset    # nukes local Supabase data (CAUTION)
make db-migration name=add_contacts  # scaffolds a new migration file
make dev-stop    # tears the stack down (keeps volumes)
make dev-docker  # production app container + Mailpit, with Supabase started by CLI
```

## Seeding dev data

`make seed` fills your LOCAL Supabase with a realistic, full-coverage dataset so
every screen has something to work with, and removes the `E2E *` rows that e2e
runs leave behind. It is **localhost-only** (it refuses to run unless
`NEXT_PUBLIC_SUPABASE_URL` points at a loopback host — `127.0.0.1`, `localhost`,
or IPv6 `::1`/`[::1]`) and **idempotent** (wipe-then-insert scoped to the dev
org), so you can re-run it any time.

Prereqs: just the dev stack running (`make dev`). `make seed` creates the dev
user + org itself via the service role, so you don't need to sign in via
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
  injects reply messages into Mailpit (http://localhost:8025). Open the Email
  Queue and click **Scan inbox now** — the scanner correlates each reply to the
  contact by sender address and records it.
- **Bounces (live):** use the in-app **Sim bounce** button on the Email Queue
  (default `mock` driver). The Mailpit path can't carry a recoverable failed
  recipient, so bounces are exercised through the mock driver instead.
- **History (always):** `make seed` also writes past `sent`/`reply`/`bounce`
  `email_events` so Activity, Reports and the pipeline look populated without any
  scanning.
