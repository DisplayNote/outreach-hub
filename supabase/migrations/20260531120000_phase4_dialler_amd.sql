-- Phase 4: server-orchestrated AMD dialler ("Mode B").
-- Three org-scoped tables capture a dialler run, each dialled attempt within it,
-- and an append-only per-attempt event log. They follow the Phase-1/2 conventions
-- (denormalised org_id, RLS keyed on public.current_org_id(), set_updated_at()
-- triggers on mutable rows) and are added to the supabase_realtime publication so
-- the browser observes call-state transitions live.
--
-- Write model (PHASE_4_SPEC §2.4, DECISION 4.1): the lifecycle is driven ONLY by
-- trusted server code (the Telnyx webhook route and the AMD Server Actions) using
-- the service role, which bypasses RLS. Clients get SELECT only — enough for the
-- Realtime subscription and for reads — so a browser can never PATCH a call into a
-- fake state via PostgREST. Hence: RLS enabled + SELECT policies only; no client
-- INSERT/UPDATE/DELETE policies (with RLS on and no policy, those are denied for
-- the authenticated role regardless of default grants).

-- Enum ------------------------------------------------------------------------

-- Lifecycle states of a single AMD call attempt (PHASE_4_SPEC §3). Lower-case
-- members, like contact_status / touchpoint_channel.
create type public.call_attempt_state as enum (
  'queued',
  'dialing',
  'ringing',
  'answered',
  'machine',
  'bridged',
  'ended',
  'failed'
);

-- Tables ----------------------------------------------------------------------

-- One AMD run: a batch the rep started. The run_id is what the client subscribes
-- to over Realtime and what correlates attempts.
create table public.call_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  mode text not null default 'amd',
  status text not null default 'active' check (status in ('active', 'paused', 'done')),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One dialled contact within a run: the live state row the UI renders.
create table public.call_attempts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  run_id uuid not null references public.call_runs(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  to_number text not null,
  from_number text,
  provider text not null default 'telnyx',
  call_control_id text,
  state public.call_attempt_state not null default 'queued',
  amd_result text,
  disposition text,
  hangup_cause text,
  error text,
  -- Set once the hangup/bridge actuation for this attempt has been confirmed.
  -- Lets a retried webhook re-attempt a lost actuation without re-logging the
  -- touchpoint or re-transitioning (at-least-once actuation; PHASE_4_SPEC §4).
  actuated_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Append-only per-attempt event log: the audit trail + the Realtime feed. Mirrors
-- touchpoints (immutable; no updated_at, no UPDATE/DELETE policy).
create table public.call_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  attempt_id uuid not null references public.call_attempts(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Indexes ---------------------------------------------------------------------

create index call_runs_org_id_idx on public.call_runs (org_id);
create index call_attempts_run_id_idx on public.call_attempts (run_id);
create index call_attempts_org_state_idx on public.call_attempts (org_id, state);
create index call_attempts_contact_id_idx on public.call_attempts (contact_id);
-- Webhook correlation arbiter: Telnyx events arrive keyed by call_control_id.
-- Partial unique so the many rows still queued (no id yet) coexist.
create unique index call_attempts_call_control_id_uidx
  on public.call_attempts (call_control_id)
  where call_control_id is not null;

-- Enforce "at most one live attempt per run" atomically at the DB layer. The
-- placeAmdCall count-then-insert check is a fast path for a friendly message,
-- but two concurrent calls could both observe zero; this partial unique index
-- makes the second insert fail with a unique violation instead (the predicate
-- is over the immutable enum column, so it is a valid partial-index condition).
create unique index call_attempts_one_live_per_run_uidx
  on public.call_attempts (run_id)
  where state in ('queued', 'dialing', 'ringing', 'answered', 'machine', 'bridged');
create index call_events_attempt_id_idx on public.call_events (attempt_id);
create index call_events_org_type_occurred_idx
  on public.call_events (org_id, event_type, occurred_at);

-- updated_at triggers (reuse public.set_updated_at() from the Phase-1 migration) -

create trigger set_call_runs_updated_at
  before update on public.call_runs
  for each row
  execute function public.set_updated_at();

create trigger set_call_attempts_updated_at
  before update on public.call_attempts
  for each row
  execute function public.set_updated_at();

-- RLS -------------------------------------------------------------------------
-- SELECT-only for clients (enables the per-run Realtime subscription and reads).
-- All writes are service-role (webhook route + Server Actions) — see header.

alter table public.call_runs enable row level security;
alter table public.call_attempts enable row level security;
alter table public.call_events enable row level security;

create policy "call_runs select own org"
  on public.call_runs for select
  using (org_id = public.current_org_id());

create policy "call_attempts select own org"
  on public.call_attempts for select
  using (org_id = public.current_org_id());

create policy "call_events select own org"
  on public.call_events for select
  using (org_id = public.current_org_id());

-- Realtime --------------------------------------------------------------------
-- Publish the three tables so postgres_changes streams inserts/updates to
-- subscribers (filtered per-org by the SELECT policies above).

alter publication supabase_realtime add table public.call_runs;
alter publication supabase_realtime add table public.call_attempts;
alter publication supabase_realtime add table public.call_events;
