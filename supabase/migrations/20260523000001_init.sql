-- Phase 0: minimal schema. Real domain (campaigns, contacts, touchpoints) lands in Phase 1.

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id),
  email text not null unique,
  full_name text,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.organizations enable row level security;
alter table public.users enable row level security;

-- Helper: org_id of current authenticated user. SECURITY DEFINER so RLS policies can call it
-- without recursing into the policy they belong to.
create or replace function public.current_org_id()
  returns uuid
  language sql
  stable
  security definer
  set search_path = public
as $$
  select org_id from public.users where id = auth.uid()
$$;

create policy "users see their own org"
  on public.organizations for select
  using (id = public.current_org_id());

create policy "users see members of their org"
  on public.users for select
  using (org_id = public.current_org_id());

create policy "users update own profile"
  on public.users for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- Bootstrap: when a new auth.users row is inserted (first OAuth login), auto-create a personal
-- organization and link the user to it as owner. Phase 1 will introduce explicit invite flows;
-- for Phase 0 this is enough to validate end-to-end Auth.
create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  new_org_id uuid;
begin
  insert into public.organizations (name)
  values (coalesce(new.raw_user_meta_data ->> 'org_name', new.email || '''s org'))
  returning id into new_org_id;

  insert into public.users (id, org_id, email, full_name, role)
  values (
    new.id,
    new_org_id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    'owner'
  );

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
