-- Phase 2 review fixes.
--
-- 1) Server-only storage for the per-user delegated Graph tokens. The tokens
--    must NEVER be projected onto the Auth.js Session (which is served at
--    GET /api/auth/session to the browser) nor left on the JWT cookie beyond
--    what's needed. We store them in their own table, RLS-scoped to the owning
--    user, read only by server code (lib/graph/token.ts) via withRls. Phase 4
--    adds refresh-on-expiry on top of this same table.
create table if not exists public.user_graph_tokens (
  user_id       uuid primary key references public.users (id) on delete cascade,
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,
  updated_at    timestamptz not null default now()
);

alter table public.user_graph_tokens enable row level security;

-- Owner-only: a session can read/write ONLY its own token row. app_user (the
-- app's non-owner role) is subject to this; the migration owner bypasses RLS.
drop policy if exists "graph tokens own" on public.user_graph_tokens;
create policy "graph tokens own" on public.user_graph_tokens
  for all
  using (user_id = public.current_user_id())
  with check (user_id = public.current_user_id());

-- 2) Provisioning casing + concurrency: the legacy users.email UNIQUE is
--    case-sensitive, but provision_user matches case-insensitively. Add a
--    lower(email) unique index so the idempotent lookup and the constraint
--    agree, and serialize concurrent first-logins for the same email with a
--    transaction advisory lock so two simultaneous logins dedupe instead of one
--    failing on a unique violation.
create unique index if not exists users_email_lower_uidx on public.users (lower(email));

create or replace function public.provision_user(p_email text, p_name text default null)
  returns table (user_id uuid, org_id uuid, role text)
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_user_id uuid;
  v_org_id  uuid;
  v_role    text;
  v_new_id  uuid;
begin
  -- Serialize concurrent first-logins for the SAME email (released at tx end),
  -- so the loser sees the winner's row via the case-insensitive lookup below
  -- rather than racing into a duplicate insert.
  perform pg_advisory_xact_lock(hashtext(lower(p_email)));

  select u.id, u.org_id, u.role
    into v_user_id, v_org_id, v_role
    from public.users u
   where lower(u.email) = lower(p_email)
   limit 1;

  if found then
    user_id := v_user_id;
    org_id := v_org_id;
    role := v_role;
    return next;
    return;
  end if;

  v_new_id := gen_random_uuid();

  insert into auth.users (id, email)
  values (v_new_id, p_email);

  insert into public.organizations (name)
  values (coalesce(nullif(p_name, ''), p_email || '''s org'))
  returning id into v_org_id;

  insert into public.users (id, org_id, email, full_name, role)
  values (v_new_id, v_org_id, p_email, nullif(p_name, ''), 'owner')
  returning public.users.id, public.users.org_id, public.users.role
       into v_user_id, v_org_id, v_role;

  user_id := v_user_id;
  org_id := v_org_id;
  role := v_role;
  return next;
end;
$$;

grant execute on function public.provision_user(text, text) to app_user;
