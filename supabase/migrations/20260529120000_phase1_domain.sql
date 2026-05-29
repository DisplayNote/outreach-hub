-- Phase 1: normalised outreach domain (campaigns, contacts, touchpoints).
-- Builds on the Phase 0 organizations/users schema in 20260523000001_init.sql.
-- Every table is org-scoped (denormalised org_id) so RLS policies stay a simple
-- "org_id = public.current_org_id()". The importer runs as the service role and
-- bypasses RLS, so legacy_id columns exist purely for idempotent upsert.

-- Enums -----------------------------------------------------------------------

-- Contact funnel status. Mirrors the legacy PWA's status values verbatim.
create type public.contact_status as enum (
  'none',
  'amber',
  'red',
  'green',
  'meeting',
  'notinterested',
  'bounced'
);

-- Touchpoint channel. Legacy used title-case (Email|Phone|LinkedIn|Other); we
-- normalise to lower-case enum members and the importer maps on the way in.
create type public.touchpoint_channel as enum (
  'email',
  'phone',
  'linkedin',
  'other'
);

-- Tables ----------------------------------------------------------------------

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  name text not null,
  sequence text,
  -- bigint: legacy campaign ids derive from an epoch like camp_1747300000000,
  -- which overflows int4.
  legacy_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  first_name text,
  last_name text,
  email text,
  company text,
  phone text,
  mobile text,
  job_title text,
  seniority text,
  country text,
  linkedin text,
  status public.contact_status not null default 'none',
  sequence_day int,
  follow_up date,
  notes text,
  legacy_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.touchpoints (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  channel public.touchpoint_channel not null,
  note text,
  occurred_at timestamptz not null default now(),
  legacy_id text,
  created_at timestamptz not null default now()
);

-- Indexes ---------------------------------------------------------------------

create index contacts_org_id_idx on public.contacts (org_id);
create index contacts_campaign_id_idx on public.contacts (campaign_id);
create index contacts_follow_up_idx on public.contacts (follow_up);
create index contacts_status_idx on public.contacts (status);
create index touchpoints_contact_id_idx on public.touchpoints (contact_id);
create index touchpoints_org_id_occurred_at_idx on public.touchpoints (org_id, occurred_at);

-- Idempotent-import keys. These are plain (non-partial) unique indexes so they
-- can serve as the arbiter for the importer's `INSERT ... ON CONFLICT
-- (org_id, legacy_id)` upsert (PostgREST cannot supply a partial-index
-- predicate). Rows created natively in the app leave legacy_id NULL; Postgres
-- treats NULLs as distinct by default, so any number of legacy_id-less rows
-- still coexist per org.
create unique index campaigns_org_legacy_id_uidx
  on public.campaigns (org_id, legacy_id);
create unique index contacts_org_legacy_id_uidx
  on public.contacts (org_id, legacy_id);
create unique index touchpoints_org_legacy_id_uidx
  on public.touchpoints (org_id, legacy_id);

-- updated_at trigger ----------------------------------------------------------

create or replace function public.set_updated_at()
  returns trigger
  language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_campaigns_updated_at
  before update on public.campaigns
  for each row
  execute function public.set_updated_at();

create trigger set_contacts_updated_at
  before update on public.contacts
  for each row
  execute function public.set_updated_at();

-- RLS -------------------------------------------------------------------------

alter table public.campaigns enable row level security;
alter table public.contacts enable row level security;
alter table public.touchpoints enable row level security;

-- campaigns
create policy "campaigns select own org"
  on public.campaigns for select
  using (org_id = public.current_org_id());

create policy "campaigns insert own org"
  on public.campaigns for insert
  with check (org_id = public.current_org_id());

create policy "campaigns update own org"
  on public.campaigns for update
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

create policy "campaigns delete own org"
  on public.campaigns for delete
  using (org_id = public.current_org_id());

-- contacts
create policy "contacts select own org"
  on public.contacts for select
  using (org_id = public.current_org_id());

create policy "contacts insert own org"
  on public.contacts for insert
  with check (org_id = public.current_org_id());

create policy "contacts update own org"
  on public.contacts for update
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

create policy "contacts delete own org"
  on public.contacts for delete
  using (org_id = public.current_org_id());

-- touchpoints
create policy "touchpoints select own org"
  on public.touchpoints for select
  using (org_id = public.current_org_id());

create policy "touchpoints insert own org"
  on public.touchpoints for insert
  with check (org_id = public.current_org_id());

create policy "touchpoints update own org"
  on public.touchpoints for update
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

create policy "touchpoints delete own org"
  on public.touchpoints for delete
  using (org_id = public.current_org_id());
