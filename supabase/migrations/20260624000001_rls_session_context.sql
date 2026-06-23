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
-- (the owner/superuser used for migrations bypasses RLS). In production the
-- password is sourced from Key Vault; 'apppw' is the local-dev value only.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user login password 'apppw';
  end if;
end $$;
grant usage on schema public to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema public to app_user;
alter default privileges in schema public grant select, insert, update, delete on tables to app_user;
alter default privileges in schema public grant execute on functions to app_user;
