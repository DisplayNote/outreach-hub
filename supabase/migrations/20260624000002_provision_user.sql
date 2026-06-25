-- First-login provisioning for the Azure stack.
--
-- On Supabase, the on_auth_user_created trigger (init migration) fired when
-- Supabase Auth inserted into auth.users, and handle_new_user() created a
-- personal organization + a public.users row (role 'owner'). On Azure, Auth.js
-- owns identity and auth.users is NEVER written by the app, so that trigger can
-- never fire — provisioning must happen on the app's privileged first-login
-- path instead.
--
-- The app connects as app_user (a NON-owner role, so RLS applies and it has no
-- INSERT privilege on auth.users). At first login there is no session yet, so a
-- direct INSERT into organizations/users would hit the RLS WITH CHECK
-- (org_id = current_org_id() with no GUC set) and the auth.users FK would be
-- ungrantable. We therefore encapsulate the legacy bootstrap in a SECURITY
-- DEFINER function owned by the migration owner: it runs with the owner's
-- rights (bypassing RLS and the auth.users grant restriction) but exposes only
-- the single, fixed bootstrap operation. EXECUTE is granted to app_user.
--
-- Semantics replicate handle_new_user() EXACTLY:
--   * existing email  -> idempotently return that user's row (id, org_id, role)
--   * unknown  email  -> create auth.users (FK target) + a personal organization
--                        named from p_name/email, link a public.users row as
--                        'owner', return it.
-- No new org-assignment logic is invented; a fresh email becomes the owner of a
-- freshly created org, exactly as the legacy trigger did.

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
  -- Idempotent fast path: an already-provisioned email returns its row. Match
  -- the legacy unique(email) key; users.email is stored verbatim at creation,
  -- so compare case-insensitively to be safe against casing drift.
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

  -- Unknown email: bootstrap exactly as handle_new_user() did. The auth.users
  -- row exists only to satisfy public.users.id's FK (it is never read by the
  -- app on Azure); we mint its id here and reuse it as the public.users id so
  -- the two stay 1:1 like the legacy auth-trigger pairing.
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

-- Retire the legacy auth trigger: auth.users is never inserted into on Azure,
-- so it can never fire, and provisioning is now an explicit app call. Dropping
-- it removes the dead bootstrap path (and any confusion about which one runs).
drop trigger if exists on_auth_user_created on auth.users;
