-- Supabase compatibility shim for plain Postgres (local Docker + Azure Database
-- for PostgreSQL Flexible Server).
--
-- The existing migrations were authored against a Supabase-managed Postgres,
-- which ships an `auth` schema, the `anon`/`authenticated`/`service_role`
-- roles, and a `supabase_realtime` publication. None of those exist on a vanilla
-- Postgres server. The Azure migration keeps those migrations VERBATIM (per the
-- design spec), so this shim — applied first by lexical order — provides the
-- minimal objects they reference. It is idempotent and safe to re-run.
--
-- Identity is later re-sourced from per-request session GUCs (app.user_id /
-- app.org_id) in 20260624000001_rls_session_context.sql; `auth.uid()` here reads
-- the same GUC so the legacy references resolve consistently in the meantime.

create schema if not exists auth;

-- Minimal `auth.users` so the FK and bootstrap trigger in the init migration can
-- be created. On Azure this table is never written to by the app (Auth.js owns
-- identity and inserts straight into public.users); it exists only so the legacy
-- DDL applies.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- `auth.uid()` resolves to the per-request session GUC (set by withRls), matching
-- public.current_user_id(). Returns null when unset.
create or replace function auth.uid()
  returns uuid
  language sql
  stable
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- Grant-target roles referenced by later migrations (revoke/grant statements).
-- NOLOGIN: these are privilege buckets, not connectable accounts.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end $$;

-- The publication later migrations append realtime tables to. Created empty;
-- ALTER PUBLICATION ... ADD TABLE in those migrations fills it in.
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
