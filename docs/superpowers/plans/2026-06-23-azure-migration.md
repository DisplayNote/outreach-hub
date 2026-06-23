# Azure-native Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Outreach Hub off Supabase + Vercel onto an Azure-native stack (ACA + Azure Database for PostgreSQL Flexible Server + Entra via Auth.js + Drizzle/pg with RLS preserved), with no behaviour change, in a single PR.

**Architecture:** Keep the Postgres schema, RLS policies, and plpgsql RPCs verbatim; re-source the RLS context from per-request session GUCs instead of Supabase's `auth` schema. Replace the supabase-js data clients with a `pg` pool + Drizzle behind a `withRls(ctx, fn)` transaction wrapper. Replace Supabase Auth with Auth.js v5 (Entra provider); the session feeds the RLS GUCs. Replace Vercel Cron with an ACA Job, Supabase Realtime with polling, and provision everything with Terraform `azurerm`.

**Tech Stack:** Next.js 15 (App Router, standalone) · TypeScript strict · `pg` + `drizzle-orm` · `next-auth@5` (Auth.js) Microsoft Entra ID provider · `@azure/msal-node` (cron app-only Graph token) · Azure Container Apps + Jobs · Azure Database for PostgreSQL Flexible Server · Azure Key Vault · Azure Container Registry · Terraform `azurerm`.

**Spec:** [docs/superpowers/specs/2026-06-23-azure-migration-design.md](../specs/2026-06-23-azure-migration-design.md)

## Global Constraints

- TypeScript strict + `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`. No `@ts-ignore` (`@ts-expect-error <reason>` only).
- Imports via the `@/*` alias; no `../../..` chains.
- Node **24.x** (`package.json#engines >=24.13`, Dockerfile `node:24.13`).
- Conventional Commits; subject < 72 chars. One clean commit per task. Single PR (`feat/azure-migration`).
- **RLS stays the multi-tenant boundary.** Every user-facing DB access goes through `withRls`. Privileged paths (cron, `/api/unsubscribe`) set the org claim from trusted input only.
- Keep existing SQL migrations in `supabase/migrations/*` as-is; new schema changes are new migration files run by the migration runner (Task 2.x), not Drizzle's generator.
- Don't `terraform apply` from CI without the manual gate; secrets only via Key Vault / `TF_VAR_*` — never committed.
- No feature changes. Behaviour parity with today.

## Canonical interfaces (used across tasks)

```ts
// lib/db/client.ts
export const pool: import('pg').Pool;          // shared pg pool, role `app_user`
export const db: NodePgDatabase;                // drizzle bound to pool (no tx)

// lib/db/rls.ts
export interface RlsContext { userId: string | null; orgId: string }
export function withRls<T>(ctx: RlsContext, fn: (tx: DrizzleTx) => Promise<T>): Promise<T>;
//   opens a tx; SET LOCAL app.user_id / app.org_id; runs fn; commits (rolls back on throw)
export type DrizzleTx = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0];

// lib/auth/session.ts  (wraps Auth.js)
export interface AppSession { userId: string; email: string; orgId: string; role: string }
export function requireSession(): Promise<AppSession>;        // throws if unauthenticated
export function getSession(): Promise<AppSession | null>;
export function rlsCtxFromSession(s: AppSession): RlsContext; // { userId: s.userId, orgId: s.orgId }

// lib/auth/admin.ts  (unchanged signature)
export function requireAdmin(): Promise<AppSession>;          // notFound() if not allowlisted

// lib/supabase/org.ts → lib/auth/org.ts (same exports, new impl)
export function getCurrentOrgId(): Promise<string>;
export function getCurrentUser(): Promise<CurrentUser>;       // { id,email,orgId,role }

// lib/graph/token.ts
export function delegatedGraphToken(): Promise<string>;       // from session, refreshed
export function appOnlyGraphToken(): Promise<string>;         // MSAL client-credentials (cron)
```

GUC names: **`app.user_id`**, **`app.org_id`**. RLS readers: **`public.current_user_id()`**, **`public.current_org_id()`**.

---

# Phase 1 — Azure foundations (IaC + DB connectivity)

### Task 1.1: Terraform azurerm skeleton (providers + resource group + ACR)

**Files:**
- Modify: `infra/providers.tf` (add `azurerm`, remove `vercel`/`supabase` blocks)
- Create: `infra/azure_core.tf`
- Modify: `infra/variables.tf` (add Azure vars), `infra/outputs.tf`

**Interfaces:**
- Produces: `azurerm_resource_group.this`, `azurerm_container_registry.this` (login server output `acr_login_server`).

- [ ] **Step 1: Replace providers**

```hcl
# infra/providers.tf
terraform {
  required_version = ">= 1.7"
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 4.0" }
  }
}
provider "azurerm" {
  features {}
  subscription_id = var.azure_subscription_id
}
```

- [ ] **Step 2: Add core resources**

```hcl
# infra/azure_core.tf
resource "azurerm_resource_group" "this" {
  name     = "rg-outreach-${var.env}"
  location = var.azure_location
}

resource "azurerm_container_registry" "this" {
  name                = "acroutreach${var.env}"   # globally unique, alnum only
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  sku                 = "Basic"
  admin_enabled       = false
}
```

- [ ] **Step 3: Add variables**

```hcl
# infra/variables.tf — append
variable "azure_subscription_id" { type = string }
variable "azure_location"        { type = string, default = "uksouth" }
```

- [ ] **Step 4: Validate**

Run: `terraform -chdir=infra init -backend=false && terraform -chdir=infra validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 5: Format + commit**

```bash
terraform -chdir=infra fmt
git add infra/ && git commit -m "infra(azure): providers + resource group + ACR"
```

### Task 1.2: Azure Postgres Flexible Server + Key Vault (Terraform)

**Files:** Create `infra/azure_data.tf`; Modify `infra/variables.tf`, `infra/outputs.tf`.

**Interfaces:**
- Produces: `azurerm_postgresql_flexible_server.this` (FQDN output `pg_fqdn`), `azurerm_key_vault.this`.

- [ ] **Step 1: Postgres + Key Vault**

```hcl
# infra/azure_data.tf
resource "azurerm_postgresql_flexible_server" "this" {
  name                          = "psql-outreach-${var.env}"
  resource_group_name           = azurerm_resource_group.this.name
  location                      = azurerm_resource_group.this.location
  version                       = "16"
  administrator_login           = var.pg_admin_login
  administrator_password        = var.pg_admin_password
  sku_name                      = "B_Standard_B1ms"
  storage_mb                    = 32768
  public_network_access_enabled = true   # tighten to VNet in a follow-up
  zone                          = "1"
}

resource "azurerm_postgresql_flexible_server_database" "app" {
  name      = "outreach"
  server_id = azurerm_postgresql_flexible_server.this.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

# Allow Azure services (ACA) to reach the server while public access is on.
resource "azurerm_postgresql_flexible_server_firewall_rule" "azure" {
  name             = "allow-azure"
  server_id        = azurerm_postgresql_flexible_server.this.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

resource "azurerm_key_vault" "this" {
  name                = "kv-outreach-${var.env}"
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  tenant_id           = var.azure_tenant_id
  sku_name            = "standard"
  rbac_authorization_enabled = true
}
```

- [ ] **Step 2: Variables** — append `pg_admin_login`, `pg_admin_password` (sensitive), `azure_tenant_id` to `infra/variables.tf`.

- [ ] **Step 3: Validate + fmt + commit**

Run: `terraform -chdir=infra validate` → `Success`.
```bash
terraform -chdir=infra fmt && git add infra/ && git commit -m "infra(azure): postgres flexible server + key vault"
```

### Task 1.3: Add `pg` + `drizzle-orm`; build the DB client

**Files:** Modify `package.json`, `pnpm-workspace.yaml#allowBuilds` (pg native); Create `lib/db/client.ts`; Test `tests/unit/db/client.test.ts`.

**Interfaces:**
- Produces: `pool: Pool`, `db: NodePgDatabase` (per canonical interfaces).

- [ ] **Step 1: Install deps**

Run: `pnpm add pg drizzle-orm && pnpm add -D @types/pg`
If pnpm flags a native build for `pg`/`libpq`: add it to `pnpm-workspace.yaml#allowBuilds` (ADR 001).

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/db/client.test.ts
import { describe, it, expect } from 'vitest';
import { pool } from '@/lib/db/client';
describe('db client', () => {
  it('exposes a pg Pool configured from DATABASE_URL', () => {
    expect(pool).toBeDefined();
    expect(typeof pool.connect).toBe('function');
  });
});
```

- [ ] **Step 3: Run → fails** (`Cannot find module '@/lib/db/client'`). Run: `pnpm exec vitest run tests/unit/db/client.test.ts`.

- [ ] **Step 4: Implement**

```ts
// lib/db/client.ts
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { getServerEnv } from '@/lib/env';

// Single shared pool. `app_user` is a NON-owner role so RLS applies; the owner
// role (migrations) is never used by the app at runtime.
export const pool = new Pool({
  connectionString: getServerEnv().DATABASE_URL,
  max: Number(process.env.PGPOOL_MAX ?? 10),
  // VERIFY TLS — never rejectUnauthorized:false. Azure Postgres Flexible Server
  // presents a DigiCert Global Root G2 cert, which is in Node's default CA store.
  // If a bundle is needed, set ca from the Azure root PEM (PGSSLROOTCERT).
  ssl: { rejectUnauthorized: true },
});
export const db = drizzle(pool);
```

- [ ] **Step 5: Add `DATABASE_URL` to env schema** — in `lib/env.ts` `serverEnvSchema`, add `DATABASE_URL: z.string().url()` (required). Keep `NEXT_PUBLIC_SUPABASE_*` optional for now (removed in Phase 6).

- [ ] **Step 6: Run → passes.** Commit.

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml lib/db/client.ts lib/env.ts tests/unit/db/client.test.ts
git commit -m "feat(db): pg pool + drizzle client, DATABASE_URL env"
```

### Task 1.4: Migration runner + RLS-compat migration

**Files:** Create `scripts/migrate.mjs`, `supabase/migrations/20260624000001_rls_session_context.sql`; Modify `Makefile` (`db-migrate` target).

**Interfaces:**
- Produces: `public.current_user_id()`, redefined `public.current_org_id()`, role `app_user`. All existing policies now read session GUCs.

- [ ] **Step 1: RLS-compat migration**

```sql
-- supabase/migrations/20260624000001_rls_session_context.sql
-- Re-source RLS identity from per-request session GUCs (set by withRls) instead
-- of Supabase's auth schema, which does not exist on Azure Postgres.

create or replace function public.current_user_id()
returns uuid language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function public.current_org_id()
returns uuid language sql stable as $$
  select nullif(current_setting('app.org_id', true), '')::uuid
$$;

-- Policies that referenced auth.uid() directly must now use current_user_id().
drop policy if exists "users update own profile" on public.users;
create policy "users update own profile" on public.users
  for update using (id = public.current_user_id())
  with check (id = public.current_user_id());

-- App runtime role: RLS APPLIES (unlike the owner/superuser used for migrations).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user nologin;
  end if;
end $$;
grant usage on schema public to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema public to app_user;
alter default privileges in schema public grant select, insert, update, delete on tables to app_user;
alter default privileges in schema public grant execute on functions to app_user;
```

> NOTE for the implementer: grep every migration for `auth.uid()` / `auth.jwt()` (`grep -rn "auth\.\(uid\|jwt\)" supabase/migrations`) and add a `drop/create policy` pair here for EACH remaining occurrence, swapping `auth.uid()` → `public.current_user_id()`. The init migration's "users update own profile" is shown; repeat the pattern for any others found.

- [ ] **Step 2: Migration runner**

```js
// scripts/migrate.mjs — applies supabase/migrations/*.sql in lexical order, tracked in a _migrations table.
import { readdirSync, readFileSync } from 'node:fs';
import { Client } from 'pg';
const dir = new URL('../supabase/migrations/', import.meta.url);
const client = new Client({ connectionString: process.env.DATABASE_URL_ADMIN, ssl: { rejectUnauthorized: true } });
await client.connect();
await client.query('create table if not exists public._migrations (name text primary key, applied_at timestamptz default now())');
const done = new Set((await client.query('select name from public._migrations')).rows.map(r => r.name));
for (const name of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
  if (done.has(name)) continue;
  const sql = readFileSync(new URL(name, dir), 'utf8');
  await client.query('begin');
  try { await client.query(sql); await client.query('insert into public._migrations(name) values ($1)', [name]); await client.query('commit'); }
  catch (e) { await client.query('rollback'); console.error(`migration ${name} failed`, e); process.exit(1); }
  console.log(`applied ${name}`);
}
await client.end();
```

> `DATABASE_URL_ADMIN` connects as the server admin (owner) so migrations can manage roles/policies; the app uses `DATABASE_URL` (`app_user`).

- [ ] **Step 3: Makefile target**

```make
db-migrate:  ## Apply SQL migrations to the target DB (DATABASE_URL_ADMIN)
	@node scripts/migrate.mjs
```

- [ ] **Step 4: Commit.**

```bash
git add supabase/migrations/20260624000001_rls_session_context.sql scripts/migrate.mjs Makefile
git commit -m "feat(db): migration runner + RLS session-context compat"
```

### Task 1.5: `withRls` transaction wrapper

**Files:** Create `lib/db/rls.ts`; Test `tests/unit/db/rls.test.ts` (integration — gated on a local Postgres; see Step 1).

**Interfaces:**
- Consumes: `db`/`pool` (1.3).
- Produces: `withRls(ctx, fn)`, `RlsContext`, `DrizzleTx` (canonical interfaces).

- [ ] **Step 1: Write the failing integration test** (runs against a disposable local Postgres started by the test, skipped if `DATABASE_URL_TEST` unset)

```ts
// tests/unit/db/rls.test.ts
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { withRls } from '@/lib/db/rls';
const maybe = process.env.DATABASE_URL_TEST ? describe : describe.skip;
maybe('withRls', () => {
  it('sets app.org_id / app.user_id as transaction-local GUCs', async () => {
    const seen = await withRls({ userId: '00000000-0000-0000-0000-000000000001', orgId: '00000000-0000-0000-0000-0000000000aa' }, async (tx) => {
      const r = await tx.execute(sql`select current_setting('app.org_id', true) as org, current_setting('app.user_id', true) as usr`);
      return r.rows[0];
    });
    expect(seen).toEqual({ org: '00000000-0000-0000-0000-0000000000aa', usr: '00000000-0000-0000-0000-000000000001' });
  });
  it('clears the GUCs after the transaction (no leak across requests)', async () => {
    await withRls({ userId: null, orgId: '00000000-0000-0000-0000-0000000000bb' }, async () => {});
    const r = await (await import('@/lib/db/client')).pool.query("select current_setting('app.org_id', true) as org");
    expect(r.rows[0].org).toBe(''); // SET LOCAL did not escape the tx
  });
});
```

- [ ] **Step 2: Run → fails** (module missing). Run: `DATABASE_URL_TEST=... pnpm exec vitest run tests/unit/db/rls.test.ts`.

- [ ] **Step 3: Implement**

```ts
// lib/db/rls.ts
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';

export interface RlsContext { userId: string | null; orgId: string }
export type DrizzleTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Run `fn` inside a transaction whose session GUCs carry the caller's identity,
 * so the RLS readers (current_org_id/current_user_id) scope every query. SET
 * LOCAL is transaction-scoped, so nothing leaks to the next pooled use.
 * `set_config(..., true)` binds the value safely (no SQL injection of the id).
 */
export function withRls<T>(ctx: RlsContext, fn: (tx: DrizzleTx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${ctx.orgId}, true), set_config('app.user_id', ${ctx.userId ?? ''}, true)`);
    return fn(tx);
  });
}
```

- [ ] **Step 4: Run → passes.** Commit.

```bash
git add lib/db/rls.ts tests/unit/db/rls.test.ts && git commit -m "feat(db): withRls transaction wrapper (per-request RLS context)"
```

---

# Phase 2 — Auth (Auth.js + Entra)

### Task 2.1: Install Auth.js; configure the Entra provider + session

**Files:** Modify `package.json`; Create `lib/auth/config.ts`, `app/api/auth/[...nextauth]/route.ts`, `lib/auth/session.ts`; Modify `lib/env.ts`.

**Interfaces:**
- Produces: `auth()` (Auth.js), `requireSession`, `getSession`, `rlsCtxFromSession`, `AppSession` (canonical).

- [ ] **Step 1:** `pnpm add next-auth@beta @auth/core`.

- [ ] **Step 2: Env** — add to `serverEnvSchema`: `AUTH_SECRET` (min 1), `AZURE_AD_CLIENT_ID`, `AZURE_AD_CLIENT_SECRET`, `AZURE_AD_TENANT_ID`. (These replace `MS_CLIENT_*`.)

- [ ] **Step 3: Auth config** (full provisioning + token capture)

```ts
// lib/auth/config.ts
import NextAuth from 'next-auth';
import EntraID from 'next-auth/providers/microsoft-entra-id';
import { getServerEnv } from '@/lib/env';
import { provisionUser } from '@/lib/auth/provision';

const env = getServerEnv();
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [EntraID({
    clientId: env.AZURE_AD_CLIENT_ID, clientSecret: env.AZURE_AD_CLIENT_SECRET,
    issuer: `https://login.microsoftonline.com/${env.AZURE_AD_TENANT_ID}/v2.0`,
    authorization: { params: { scope: 'openid profile email offline_access User.Read Mail.Send Mail.Read' } },
  })],
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account) { // first login / re-auth: capture Graph tokens + provision
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;
        const { userId, orgId, role } = await provisionUser({ email: token.email as string, name: profile?.name });
        token.userId = userId; token.orgId = orgId; token.role = role;
      }
      return token;
    },
    async session({ session, token }) {
      session.user = { ...session.user, id: token.userId as string, orgId: token.orgId as string, role: token.role as string };
      return session;
    },
  },
});
```

- [ ] **Step 4: Route handler**

```ts
// app/api/auth/[...nextauth]/route.ts
import { handlers } from '@/lib/auth/config';
export const { GET, POST } = handlers;
```

- [ ] **Step 5: Session helpers**

```ts
// lib/auth/session.ts
import { auth } from '@/lib/auth/config';
import type { RlsContext } from '@/lib/db/rls';
export interface AppSession { userId: string; email: string; orgId: string; role: string }
export async function getSession(): Promise<AppSession | null> {
  const s = await auth();
  if (!s?.user?.id || !s.user.orgId) return null;
  return { userId: s.user.id, email: s.user.email ?? '', orgId: s.user.orgId, role: s.user.role };
}
export async function requireSession(): Promise<AppSession> {
  const s = await getSession();
  if (!s) throw new Error('requireSession: no authenticated session');
  return s;
}
export function rlsCtxFromSession(s: AppSession): RlsContext { return { userId: s.userId, orgId: s.orgId }; }
```

- [ ] **Step 6: Typecheck + commit.** Run: `pnpm exec tsc --noEmit` (expect a `next-auth` module-augmentation gap → add `types/next-auth.d.ts` augmenting `Session.user` with `id/orgId/role` and `JWT` with the token fields). Commit.

```bash
git add package.json pnpm-lock.yaml lib/auth/config.ts app/api/auth lib/auth/session.ts lib/env.ts types/next-auth.d.ts
git commit -m "feat(auth): Auth.js v5 with Entra provider + session helpers"
```

### Task 2.2: First-login provisioning (org + user rows)

**Files:** Create `lib/auth/provision.ts`; Test `tests/unit/auth/provision.test.ts`.

**Interfaces:**
- Consumes: `withRls`/`db` — provisioning runs on a privileged path (no session yet), so it uses `db` directly (owner-less but the `app_user` grants cover insert; org bootstrap may need the migration/admin path — see note).
- Produces: `provisionUser({ email, name? }): Promise<{ userId, orgId, role }>`.

- [ ] **Step 1: Write the failing test** (integration; skipped without `DATABASE_URL_TEST`)

```ts
// tests/unit/auth/provision.test.ts — existing user returns their row; unknown email maps to the configured default org.
import { describe, it, expect } from 'vitest';
const maybe = process.env.DATABASE_URL_TEST ? describe : describe.skip;
maybe('provisionUser', () => {
  it('returns the existing user row for a known email', async () => {
    const { provisionUser } = await import('@/lib/auth/provision');
    const r = await provisionUser({ email: 'seed-user@displaynote.com' });
    expect(r.orgId).toBeTruthy(); expect(r.userId).toBeTruthy();
  });
});
```

- [ ] **Step 2: Implement** — mirror the legacy `auth/callback` provisioning semantics (single-org: map a new authenticated email into the existing org, create the `public.users` row, default `role`). Read the current first-login behaviour from git history of `app/auth/callback/route.ts` and replicate it exactly (lookup by email → existing row, else insert into the single org). Provisioning connects via a privileged path that bypasses RLS (it has no session): use a dedicated `withServiceRls(orgId, fn)` ONLY after the org is known; the initial email→user lookup uses `db` with a query filtered by email.

> The implementer reproduces the legacy provisioning rules verbatim — do NOT invent new org-assignment logic. If the legacy callback only ever attached users to one bootstrapped org, keep that.

- [ ] **Step 3: Run → passes. Commit.**

### Task 2.3: Rewrite `getCurrentOrgId`/`getCurrentUser` + `requireAdmin` off the session

**Files:** Create `lib/auth/org.ts` (replaces `lib/supabase/org.ts`); Modify `lib/auth/admin.ts`; Modify all importers of `@/lib/supabase/org`.

**Interfaces:**
- Consumes: `getSession`/`requireSession` (2.1).
- Produces: `getCurrentOrgId()`, `getCurrentUser()` with the SAME signatures as today (canonical interfaces), so callers are unchanged except the import path.

- [ ] **Step 1: Implement** (org/role/email now come from the session — no DB round-trip)

```ts
// lib/auth/org.ts
import { requireSession } from '@/lib/auth/session';
export interface CurrentUser { id: string; email: string; orgId: string; role: string }
export async function getCurrentOrgId(): Promise<string> { return (await requireSession()).orgId; }
export async function getCurrentUser(): Promise<CurrentUser> {
  const s = await requireSession();
  return { id: s.userId, email: s.email, orgId: s.orgId, role: s.role };
}
```

- [ ] **Step 2:** Update `lib/auth/admin.ts` to import `getCurrentUser` from `@/lib/auth/org`. Signature unchanged.

- [ ] **Step 3:** Re-point importers: `grep -rl "@/lib/supabase/org" lib app` → change each to `@/lib/auth/org`. Delete `lib/supabase/org.ts`.

- [ ] **Step 4: Typecheck → passes. Commit.**

### Task 2.4: Replace the auth middleware gate + retire the Supabase auth routes

**Files:** Modify `lib/supabase/middleware.ts` → `lib/auth/middleware.ts` (and `middleware.ts`); Delete `app/auth/callback/route.ts`, `app/auth/mock/route.ts`; Modify `app/auth/signout/route.ts`, `app/login/microsoft-sign-in.tsx`.

- [ ] **Step 1:** Replace `updateSession` with an Auth.js-based gate that keeps the SAME public-path allowlist semantics we hardened (exact-or-subtree; `/login`, `/api/auth/`, `/api/email/`, `/api/telnyx/`, `/api/unsubscribe`). Use `auth` as the middleware wrapper:

```ts
// middleware.ts
export { auth as middleware } from '@/lib/auth/config';
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'] };
```
and put the public-path redirect logic in the `authorized` callback of `lib/auth/config.ts`.

- [ ] **Step 2:** Sign-in button calls `signIn('microsoft-entra-id')`; sign-out calls `signOut()`. Remove the dev mock-auth route (the dev gate is replaced by an Auth.js dev path or a seeded session — keep behaviour: local dev can still log in).

- [ ] **Step 3:** Delete `lib/supabase/middleware.ts`, `app/auth/callback`, `app/auth/mock`. Typecheck → passes. Commit.

---

# Phase 3 — Data layer rewrite (supabase-js → Drizzle + withRls)

> This is the largest phase. It is a **repeatable conversion** applied to a fixed inventory of files. Task 3.1 establishes the schema + the worked pattern; Tasks 3.2–3.N apply it file-by-file (one commit each). Each conversion task is independently testable: the existing unit tests for that area must still pass, and a new RLS deny test proves isolation holds.

### Task 3.1: Drizzle table definitions + the worked conversion pattern

**Files:** Create `lib/db/schema.ts` (Drizzle table defs mirroring the SQL schema), `lib/db/rls-service.ts` (`withServiceRls`); Test `tests/unit/db/rls-deny.test.ts`.

**Interfaces:**
- Produces: Drizzle table objects (`organizations`, `users`, `campaigns`, `contacts`, `touchpoints`, `sequences`, `sequence_steps`, `templates`, `call_runs`, `call_attempts`, `email_events`, `suppressions`, `user_settings`), and `withServiceRls(orgId, fn)` for cron/unsubscribe.

- [ ] **Step 1:** Define Drizzle tables matching `supabase/migrations/*` column-for-column (names/types/nullability). Generate-then-verify: `pnpm exec drizzle-kit introspect` against the migrated test DB, then hand-reconcile into `lib/db/schema.ts`.

- [ ] **Step 2: `withServiceRls`** (privileged org-scoped path; no user)

```ts
// lib/db/rls-service.ts
import { withRls } from '@/lib/db/rls';
import type { DrizzleTx } from '@/lib/db/rls';
/** Org-scoped access for trusted server paths with NO user session (cron for
 *  CRON_ORG_ID, the unsubscribe token's org). userId is null → user-scoped
 *  policies deny, org-scoped policies apply for `orgId`. */
export function withServiceRls<T>(orgId: string, fn: (tx: DrizzleTx) => Promise<T>): Promise<T> {
  return withRls({ userId: null, orgId }, fn);
}
```

- [ ] **Step 3: RLS deny test** (proves isolation survives the rewrite)

```ts
// tests/unit/db/rls-deny.test.ts
import { describe, it, expect } from 'vitest';
import { withRls } from '@/lib/db/rls';
import { contacts } from '@/lib/db/schema';
const maybe = process.env.DATABASE_URL_TEST ? describe : describe.skip;
maybe('RLS isolation', () => {
  it('org A cannot read org B rows', async () => {
    // seed: contact in org B (via withServiceRls(orgB)); then read as org A → empty
    const rowsForA = await withRls({ userId: null, orgId: 'org-A-uuid' }, (tx) => tx.select().from(contacts));
    expect(rowsForA.find((c) => c.orgId === 'org-B-uuid')).toBeUndefined();
  });
});
```

- [ ] **Step 4: WORKED EXAMPLE — convert `lib/actions/settings.ts`** (the smallest action) end-to-end as the reference all later conversions follow:

```ts
// BEFORE: const supabase = await createClient(); await supabase.from('organizations').select('settings').eq('id', orgId).single();
// AFTER:
import { withRls } from '@/lib/db/rls';
import { rlsCtxFromSession, requireSession } from '@/lib/auth/session';
import { organizations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
// inside updateOrgSettings, after requireAdmin():
const session = await requireSession();
const merged = await withRls(rlsCtxFromSession(session), async (tx) => {
  const [current] = await tx.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, session.orgId));
  const next = mergeOrgSettingsPatch(current?.settings ?? {}, parsed);
  const [row] = await tx.update(organizations).set({ settings: next }).where(eq(organizations.id, session.orgId)).returning({ settings: organizations.settings });
  if (!row) throw new Error('updateOrgSettings: update affected no row');
  return row.settings;
});
```

- [ ] **Step 5:** Run `pnpm exec vitest run tests/unit/db/` + the settings tests → pass. Commit `lib/db/schema.ts`, `lib/db/rls-service.ts`, the converted `settings.ts`, and the tests.

### Tasks 3.2 – 3.14: Convert each data-access module (one commit each)

Apply the Task 3.1 pattern to each file below. **For each:** (a) replace `createClient()`/`createServiceClient()` with `withRls(rlsCtxFromSession(await requireSession()), …)` for user paths or `withServiceRls(orgId, …)` for service paths; (b) replace `.from(x).select/insert/update/delete` chains with the Drizzle equivalents against `lib/db/schema`; (c) preserve every existing guard (the row-affected asserts, status precedence, ON CONFLICT/upsert via `.onConflictDoNothing`/`.onConflictDoUpdate`, the CAS loop in `dialler.ts`); (d) keep RPC calls as `tx.execute(sql\`select * from due_email_contacts(...)\`)`; (e) run that module's existing unit tests → green; (f) commit.

Inventory (exact targets):

- [ ] **3.2** `lib/supabase/queries.ts` (672 lines — the read layer) → `lib/db/queries.ts`. Split by domain if it stays unwieldy (campaigns/contacts/sequences/templates/dashboard).
- [ ] **3.3** `lib/actions/contacts.ts`  - [ ] **3.4** `lib/actions/campaigns.ts`  - [ ] **3.5** `lib/actions/sequences.ts`
- [ ] **3.6** `lib/actions/templates.ts`  - [ ] **3.7** `lib/actions/user-settings.ts`  - [ ] **3.8** `lib/actions/import-apollo.ts`
- [ ] **3.9** `lib/actions/dialler.ts` (preserve the `logCallOutcome` CAS-with-retry exactly)  - [ ] **3.10** `lib/actions/dialler-amd.ts`
- [ ] **3.11** `lib/dialler/amd/runtime.ts`  - [ ] **3.12** `lib/email/store.ts` (the EmailStore — keep the RPC calls; the runner/scanner cores are unchanged)
- [ ] **3.13** Server-component page reads in `app/**/page.tsx` (they call `lib/supabase/queries` → now `lib/db/queries`; mostly import swaps).
- [ ] **3.14** `lib/actions/email.ts` + `app/api/unsubscribe/route.ts` + `lib/email/cron.ts`: swap `createServiceClient()` → `withServiceRls(orgId, …)` (cron uses `CRON_ORG_ID`; unsubscribe uses the token's org). Delete `lib/supabase/service.ts`.

**Gate after 3.14:** `pnpm exec tsc --noEmit` clean; `pnpm exec vitest run` all green; `grep -rn "@supabase/supabase-js\|@supabase/ssr\|createServiceClient\|lib/supabase/server\|lib/supabase/client" lib app` returns nothing (except the dialler realtime hook handled in Phase 5).

---

# Phase 4 — Email cron (ACA Job) + Graph app-only token

### Task 4.1: MSAL app-only Graph token for the cron mailbox

**Files:** Modify `package.json` (`@azure/msal-node`); Create `lib/graph/token.ts`; Modify `lib/actions/email.ts` (delegated token from session).

**Interfaces:** Produces `appOnlyGraphToken()`, `delegatedGraphToken()` (canonical).

- [ ] **Step 1:** `pnpm add @azure/msal-node`.
- [ ] **Step 2:** Implement `appOnlyGraphToken()` via `ConfidentialClientApplication.acquireTokenByClientCredential({ scopes: ['https://graph.microsoft.com/.default'] })` using `AZURE_AD_*` env. Implement `delegatedGraphToken()` reading the session's `accessToken`, refreshing via the stored `refreshToken` when `expiresAt` is past.
- [ ] **Step 3:** `buildContext` in `lib/actions/email.ts` uses `delegatedGraphToken()`; the cron path (`lib/email/cron.ts`) uses `appOnlyGraphToken()` to construct the GraphDriver. Run email unit tests → green. Commit.

### Task 4.2: Cron entrypoint + ACA Job (Terraform) + retire Vercel cron

**Files:** Create `scripts/cron-email.mjs`; Modify `infra/azure_apps.tf` (Task 5.x adds the app; this adds the Job); Delete `vercel.json`, `app/api/email/run/route.ts`, `app/api/email/scan/route.ts` (or keep for manual trigger — decide in cleanup).

- [ ] **Step 1:** Entrypoint calls `runSenderAllOrgs`/`scanInboxAllOrgs` directly (a tiny script that imports the built server bundle, or a dedicated `tsx` entry). It needs the same env as the app (DATABASE_URL, AZURE_AD_*, CRON_ORG_ID, CRON_SENDER_EMAIL, APP_BASE_URL, UNSUBSCRIBE_SECRET).
- [ ] **Step 2:** Terraform `azurerm_container_app_job` with two cron triggers (send `15 9 * * 1-5`, scan `*/30 7-18 * * 1-5`) running the same image with a `CRON_TASK=send|scan` env switching the entrypoint. Commit.

---

# Phase 5 — Realtime → polling (dialler)

### Task 5.1: Replace the Supabase Realtime hook with polling

**Files:** Rewrite `lib/dialler/amd/realtime.ts` → `lib/dialler/amd/use-amd-run.ts`; Create `lib/actions/amd-status.ts` (server action returning the run's attempts); Modify `components/amd-run.tsx`.

- [ ] **Step 1: Write the failing test** for the status action: returns attempts for a run, org-scoped via `withRls`.
- [ ] **Step 2:** Server action `getAmdRunAttempts(runId)` → `withRls(rlsCtxFromSession(await requireSession()), tx => tx.select(...).from(callAttempts).where(eq(callAttempts.runId, runId)))`, mapped via `toCallAttempt`.
- [ ] **Step 3:** Client hook `useAmdRun(runId)` polls `getAmdRunAttempts` every 1500ms while `runId` is set (clear on unmount/`runId` change — preserve the existing unmount-safety), stops polling when the run is terminal. Same `UseAmdRunResult` shape so `components/amd-run.tsx` only changes its import.
- [ ] **Step 4:** Run → passes. Delete the Supabase realtime hook + the `supabase.realtime.setAuth` usage. Commit.

---

# Phase 6 — Hosting, CI, cutover & cleanup

### Task 6.1: ACA app + identity + Key Vault wiring (Terraform)

**Files:** Create `infra/azure_apps.tf`; Modify `infra/outputs.tf`.

- [ ] **Step 1:** `azurerm_container_app_environment`, `azurerm_container_app` (ingress 3000, the ACR image, system-assigned identity), Key Vault role assignment for the identity, and secrets wired from Key Vault → container env (DATABASE_URL, AUTH_SECRET, AZURE_AD_*, CRON_*, APP_BASE_URL, UNSUBSCRIBE_SECRET, TELNYX_*). `terraform validate` + `fmt`. Commit.

### Task 6.2: GitHub Actions — build → ACR → ACA revision

**Files:** Create `.github/workflows/deploy.yml`; Modify `.github/workflows/infra.yml` (already TF_VAR-based) for the new vars; Delete the Vercel/Supabase-specific CI bits.

- [ ] **Step 1:** On push to `main`: `az acr build` (or docker build + push) the image, then `az containerapp update` to the new image digest. Uses an Azure service-principal / OIDC secret. Commit.

### Task 6.3: Remove Supabase/Vercel deps + docs cutover

**Files:** Modify `package.json` (remove `@supabase/*`, `supabase` CLI dep), `Makefile` (drop `supabase start` flow; local dev = local Postgres + `make db-migrate`), `docs/deployment.md`, `docs/architecture.md`, `CLAUDE.md`, `PHASE_0_STATUS.md` references; Delete `supabase/config.toml`, `lib/supabase/*` remnants, `infra/vercel.tf`, `infra/supabase.tf`.

- [ ] **Step 1:** `pnpm remove @supabase/supabase-js @supabase/ssr supabase`. Run `grep -rn "supabase" lib app infra scripts --include=*.ts --include=*.tsx --include=*.tf` → only intended residue (migration filenames). 
- [ ] **Step 2:** Rewrite `docs/deployment.md` for the Azure stack (ACA + Postgres Flexible Server + Entra app reg + Key Vault + ACR + the ACA Job cron; local dev via Docker Postgres + `make db-migrate`). Update `docs/architecture.md` and `CLAUDE.md` stack section.
- [ ] **Step 3: Final gate.** `pnpm exec tsc --noEmit` clean; `pnpm exec eslint .` clean; `pnpm exec vitest run` green; `next build` succeeds; `terraform -chdir=infra validate` + `fmt -check` clean; local `make dev` (Docker Postgres + migrate + `next dev`) boots and a login + dry-run send works end-to-end. Commit.

---

## Self-review

- **Spec coverage:** D1 ACA → 6.1/6.2; D2 Postgres → 1.2/1.4; D3 Drizzle+SQL migrations → 1.3/1.4/3.1; D4 RLS preserved → 1.4/1.5/3.1 (+ deny test); D5 Auth.js+Entra → 2.1–2.4; D6 Graph delegated+app-only → 4.1; D7 polling → 5.1; D8 ACA Job cron → 4.2; D9 Key Vault/ACR/Terraform → 1.1/1.2/6.1/6.2/6.3. Relationship-to-#12 handled by basing the branch on it. All spec sections map to tasks.
- **Placeholder scan:** the only deliberately delegated detail is the legacy provisioning rules (2.2) and the per-file conversions (3.2–3.14), both with an explicit worked pattern (3.1/3.4 example) + exact file inventory — not vague "handle the rest". Acceptable for a mechanical, example-driven workstream; subagent-driven execution reads each actual file.
- **Type consistency:** `withRls(RlsContext, fn)`, `RlsContext{userId,orgId}`, `AppSession{userId,email,orgId,role}`, `getCurrentOrgId/getCurrentUser`, `delegatedGraphToken/appOnlyGraphToken` used consistently across phases; GUCs `app.user_id`/`app.org_id` and readers `current_user_id()`/`current_org_id()` match between 1.4, 1.5, and 3.1.
