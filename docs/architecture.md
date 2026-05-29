# Architecture

## Stack overview

```
                     ┌───────────────────────────┐
                     │       Microsoft Entra     │
                     │  (OAuth multi-tenant app) │
                     └─────────────┬─────────────┘
                                   │ OIDC
                                   ▼
   ┌────────┐    HTTPS    ┌────────────────┐    Postgres    ┌──────────────┐
   │ Vercel │ ◀──────────▶│   Next.js 15   │ ◀────────────▶ │   Supabase   │
   │        │             │  (App Router)  │   RLS + Auth   │  (Postgres,  │
   │        │             │                │    cookies     │   Realtime,  │
   │        │             │  Server Comps  │                │   Vault,     │
   │        │             │  Route Handlrs │                │   Storage,   │
   │        │             │  Middleware    │                │   Edge Fns)  │
   └────────┘             └───────┬────────┘                └──────┬───────┘
                                  │                                │
                                  │ EmailDriver                    │
                                  ▼                                ▼
                          ┌──────────────┐                ┌──────────────┐
                          │ MS Graph API │                │   Telnyx     │
                          │ Mail.Send /  │                │  Call Ctrl   │
                          │ Mail.Read    │                │   + AMD      │
                          └──────────────┘                └──────────────┘
```

## Decisions cerradas

| Decision | Why |
|---|---|
| Next.js App Router | Server Components reduce client JS; Server Actions remove an API layer. |
| Supabase | Postgres + Auth + Realtime + RLS + Vault on one plane — multi-tenancy "near free". |
| Microsoft OAuth as the only IdP | We need the app registration for Mail anyway; reusing it for login removes a system. |
| pnpm | Faster, disk-efficient; deterministic lockfile. |
| Vitest + Playwright | Vite-native unit speed; multi-browser e2e on CI. |
| Terraform | Mature providers for Supabase and Vercel. (DNS is managed manually, outside Terraform.) |
| `EmailDriver` interface | Lets us iterate UI without Graph for weeks; switching providers is type-safe. |
| Supabase CLI owns local Supabase | Avoids maintaining a fragile custom Compose copy of Supabase's internal service graph. |
| Single-file dev (`PaulsOutreachHub.html`) → migration target | Battle-tested domain model is preserved — only the platform layer changes. |

## Module map

- `lib/env.ts` — single source of truth for env validation (Zod). Server- vs browser-safe split.
- `lib/supabase/{client,server,middleware}.ts` — three SSR entry points per
  [supabase docs](https://supabase.com/docs/guides/auth/server-side/nextjs).
- `lib/email/` — `EmailDriver` interface and its three real / one stub implementations.
- `middleware.ts` — refreshes Supabase session cookies on every page request.
- `supabase/config.toml` — declarative config for the local stack (auth providers, ports, etc.).
- `supabase/migrations/*.sql` — schema lives here; the live DB is recreated from these.
- `Dockerfile` / `docker-compose.full.yml` — production-style local app container plus Mailpit.
  Supabase is still started by the CLI, and app-container server calls use `SUPABASE_INTERNAL_URL`.

## Phase boundaries

See [OUTREACH_HUB_EXECUTION_PLAN.md](./OUTREACH_HUB_EXECUTION_PLAN.md) §3 for the full roadmap.
Phase 0 ships the platform skeleton; Phase 1 onwards layers the domain (campaigns → contacts → touchpoints).
