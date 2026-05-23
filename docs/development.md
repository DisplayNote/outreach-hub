# Development guide

Four common dev scenarios. Pick the one that matches your task.

## Scenario A — First time on a clean machine

Prerequisites:

- Node 20.18+ (use `nvm install` against `.nvmrc`)
- pnpm 11+ (`npm install -g pnpm@11` or via corepack)
- Docker Desktop (running)
- Git
- Make (Linux/macOS ship it; Windows: `winget install GnuWin32.Make` or use WSL)

Setup:

```bash
git clone https://github.com/DisplayNote/outreach-hub.git
cd outreach-hub
# Drop your .env.bootstrap into the repo root — see §4.6 of the execution plan.
make bootstrap   # populates .env.local + infra/envs/dev.tfvars
make dev         # Mailpit + Supabase + Next.js
```

Open http://localhost:3000.

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

- An ngrok / Cloudflare tunnel exposing your local Supabase Edge Functions at a stable URL
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

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `supabase start` fails with port conflict | 54321/54322/54323 in use | Stop the conflicting service or change the port in `supabase/config.toml`. |
| `pnpm dev` exits with env validation error | `.env.local` missing or incomplete | `make bootstrap` or `cp .env.example .env.local` then fill in. |
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
```
