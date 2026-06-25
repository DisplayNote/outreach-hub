-- Re-source RLS identity from per-request session GUCs (set by withRls) instead
-- of Supabase's auth schema, which does not exist on Azure Postgres.
--
-- withRls() opens a transaction and runs `SET LOCAL app.user_id = …` /
-- `SET LOCAL app.org_id = …`; these readers expose that identity to the existing
-- RLS policies. The policies themselves are unchanged except that the few that
-- referenced auth.uid() directly now call public.current_user_id().

create or replace function public.current_user_id()
  returns uuid
  language sql
  stable
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- Redefined: was SECURITY DEFINER selecting from public.users via auth.uid();
-- now reads the org_id GUC directly. No DB round-trip, no auth schema dependency.
create or replace function public.current_org_id()
  returns uuid
  language sql
  stable
as $$
  select nullif(current_setting('app.org_id', true), '')::uuid
$$;

-- Policies that referenced auth.uid() directly must now use current_user_id().

-- init migration: public.users
drop policy if exists "users update own profile" on public.users;
create policy "users update own profile" on public.users
  for update using (id = public.current_user_id())
  with check (id = public.current_user_id());

-- user_settings migration: public.user_settings (select / insert / update)
drop policy if exists "user_settings select own" on public.user_settings;
create policy "user_settings select own" on public.user_settings
  for select using (user_id = public.current_user_id() and org_id = public.current_org_id());

drop policy if exists "user_settings insert own" on public.user_settings;
create policy "user_settings insert own" on public.user_settings
  for insert with check (user_id = public.current_user_id() and org_id = public.current_org_id());

drop policy if exists "user_settings update own" on public.user_settings;
create policy "user_settings update own" on public.user_settings
  for update using (user_id = public.current_user_id())
  with check (user_id = public.current_user_id() and org_id = public.current_org_id());

-- App runtime role: a LOGIN role the app connects AS, NON-owner so RLS APPLIES
-- (the owner/superuser used for migrations bypasses RLS). Created WITHOUT a
-- committed password — the runner (scripts/migrate.mjs) sets it from
-- APP_USER_PASSWORD (local dev) / Key Vault (Azure), so no credential lives in
-- git. Table/function grants + the organizations column-restriction are
-- (re)asserted by the runner's post-migration grant step, so future tables are
-- covered and the column-restriction is always applied last.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user login;
  end if;
end $$;
grant usage on schema public to app_user;
