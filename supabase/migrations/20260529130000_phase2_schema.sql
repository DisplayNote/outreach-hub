-- Phase 2: enrichment metadata, org settings, and the sequence/template domain.
-- Builds on the Phase 1 schema in 20260529120000_phase1_domain.sql. Every new
-- table is org-scoped (denormalised org_id) so RLS policies stay a simple
-- "org_id = public.current_org_id()", matching the Phase 1 pattern.

-- JSONB extension columns -----------------------------------------------------

-- Apollo enrichment fields without a dedicated column land here. Defaulting to
-- '{}' keeps existing rows valid and lets the importer always merge into a map.
alter table public.contacts
  add column metadata jsonb not null default '{}'::jsonb;

-- Org-level settings (e.g. import defaults, feature flags). Same '{}' default
-- so every existing organization stays valid.
alter table public.organizations
  add column settings jsonb not null default '{}'::jsonb;

-- Tables ----------------------------------------------------------------------

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  name text not null,
  subject text,
  body text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Composite key so child rows can enforce same-org references (see below).
  unique (id, org_id)
);

create table public.sequences (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Composite key so child rows can enforce same-org references (see below).
  unique (id, org_id)
);

-- sequence_steps references its parent sequence/template by (id, org_id), not by
-- id alone. RLS only checks the step's own org_id, so a plain id FK would let a
-- step point at ANOTHER org's sequence/template if the UUID were known. The
-- composite FKs below close that cross-org integrity gap. `template_id` is
-- nullable; MATCH SIMPLE skips the FK when it is null, and ON DELETE SET NULL
-- (template_id) clears only that column (org_id stays NOT NULL).
create table public.sequence_steps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  sequence_id uuid not null,
  step_order int not null,
  day_offset int not null,
  channel public.touchpoint_channel not null,
  template_id uuid,
  created_at timestamptz not null default now(),
  foreign key (sequence_id, org_id)
    references public.sequences (id, org_id) on delete cascade,
  foreign key (template_id, org_id)
    references public.templates (id, org_id) on delete set null (template_id)
);

-- Indexes ---------------------------------------------------------------------

create index templates_org_id_idx on public.templates (org_id);
create index sequences_org_id_idx on public.sequences (org_id);
create index sequence_steps_sequence_id_idx on public.sequence_steps (sequence_id);

-- One row per (sequence, step_order). step_order is NOT NULL so this is a true
-- ordering constraint, not a sparse NULL-tolerant index.
create unique index sequence_steps_sequence_order_uidx
  on public.sequence_steps (sequence_id, step_order);

-- Apollo dedupe guard. The importer dedupes on (org_id, lower(email)) via an
-- explicit select-then-update/insert and skips rows with no email, so this is a
-- pure data-integrity guard, NOT an ON CONFLICT arbiter (a partial index cannot
-- be inferred by INSERT ... ON CONFLICT). Partial so the many native rows with
-- a NULL email are not forced unique.
create unique index contacts_org_lower_email_uidx
  on public.contacts (org_id, lower(email))
  where email is not null;

-- updated_at triggers ---------------------------------------------------------
-- Reuses public.set_updated_at() defined in the Phase 1 migration.

create trigger set_templates_updated_at
  before update on public.templates
  for each row
  execute function public.set_updated_at();

create trigger set_sequences_updated_at
  before update on public.sequences
  for each row
  execute function public.set_updated_at();

-- RLS -------------------------------------------------------------------------

-- organizations had RLS enabled in Phase 0 with only a SELECT policy. Phase 2
-- introduces the `settings` column and `updateOrgSettings`, which UPDATEs the
-- caller's own organization row — without an UPDATE policy that write is
-- silently blocked by RLS (0 rows affected). Add an org-scoped UPDATE policy so
-- members can update their own org row, matching the per-table pattern below.
create policy "organizations update own org"
  on public.organizations for update
  using (id = public.current_org_id())
  with check (id = public.current_org_id());

-- Least privilege: the only org column users edit is `settings`. The row policy
-- above scopes WHICH row; these column grants scope WHICH columns, so a member
-- cannot rename their org (or touch `id`/`created_at`) by crafting a request.
-- `name` is set once by the handle_new_user trigger (SECURITY DEFINER, owner
-- privileges) and service_role keeps full UPDATE for admin paths.
revoke update on public.organizations from anon, authenticated;
grant update (settings) on public.organizations to authenticated;

alter table public.templates enable row level security;
alter table public.sequences enable row level security;
alter table public.sequence_steps enable row level security;

-- templates
create policy "templates select own org"
  on public.templates for select
  using (org_id = public.current_org_id());

create policy "templates insert own org"
  on public.templates for insert
  with check (org_id = public.current_org_id());

create policy "templates update own org"
  on public.templates for update
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

create policy "templates delete own org"
  on public.templates for delete
  using (org_id = public.current_org_id());

-- sequences
create policy "sequences select own org"
  on public.sequences for select
  using (org_id = public.current_org_id());

create policy "sequences insert own org"
  on public.sequences for insert
  with check (org_id = public.current_org_id());

create policy "sequences update own org"
  on public.sequences for update
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

create policy "sequences delete own org"
  on public.sequences for delete
  using (org_id = public.current_org_id());

-- sequence_steps
create policy "sequence_steps select own org"
  on public.sequence_steps for select
  using (org_id = public.current_org_id());

create policy "sequence_steps insert own org"
  on public.sequence_steps for insert
  with check (org_id = public.current_org_id());

create policy "sequence_steps update own org"
  on public.sequence_steps for update
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

create policy "sequence_steps delete own org"
  on public.sequence_steps for delete
  using (org_id = public.current_org_id());
