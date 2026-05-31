-- Phase 5: email runner — sequence linkage, per-message audit, and suppression.
--
-- Adds the campaign→sequence link the runner walks for cadence, a denormalised
-- contacts.last_emailed_at for cheap selection, an append-only email_events log
-- (audit + send-dedup + reply/bounce correlation), and an address-level
-- suppressions list (replaces the legacy skiplist.json). Follows the Phase-1/2
-- conventions: denormalised org_id, RLS keyed on public.current_org_id().
--
-- Write model: like the rest of the app, the runner/scanner write under the
-- caller's RLS-scoped session (manual triggers) or a service-role scoped query
-- (cron). email_events is immutable (no UPDATE/DELETE policy, like touchpoints);
-- suppressions allows DELETE so a contact who comes back can be un-suppressed.

-- Campaign → sequence link --------------------------------------------------

-- The runner reads cadence from the linked sequence's sequence_steps. The
-- free-text campaigns.sequence column stays for legacy/display but is no longer
-- load-bearing. ON DELETE SET NULL detaches campaigns rather than cascading.
alter table public.campaigns
  add column sequence_id uuid references public.sequences(id) on delete set null;

create index campaigns_sequence_id_idx on public.campaigns (sequence_id);

-- Contact send bookkeeping ----------------------------------------------------

-- Last successful send: powers the "already sent today" guard + cadence.
-- (Also derivable from email_events, but denormalised here for cheap selection.)
alter table public.contacts
  add column last_emailed_at timestamptz;

-- email_events — append-only per-message log ---------------------------------

create table public.email_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  type text not null check (type in ('sent', 'reply', 'bounce')),
  provider text not null,
  message_id text,
  conversation_id text,
  in_reply_to text,
  subject text,
  sequence_day int,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index email_events_org_type_occurred_idx
  on public.email_events (org_id, type, occurred_at);
create index email_events_contact_id_idx on public.email_events (contact_id);
-- Send-dedup arbiter (replaces the legacy sentEmailIds map): a re-run never
-- double-records the same provider message. NON-partial so it can serve as the
-- ON CONFLICT (org_id, provider, message_id) arbiter for the runner/scanner
-- upserts; every event we write carries a message_id, and Postgres treats any
-- NULLs as distinct, so rows without one still coexist.
create unique index email_events_org_provider_message_uidx
  on public.email_events (org_id, provider, message_id);

-- suppressions — address-level do-not-send -----------------------------------

create table public.suppressions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  email text not null,
  reason text not null check (reason in ('replied', 'bounced', 'manual', 'unsubscribed')),
  contact_id uuid references public.contacts(id) on delete set null,
  created_at timestamptz not null default now()
);

-- One suppression per address per org; the runner left-anti-joins on this.
-- Indexed on the plain (org_id, email) column (not lower(email)) so it can be
-- the ON CONFLICT (org_id, email) arbiter for the upserts — every writer
-- lowercases the email first, so the column already holds the normalised form.
create unique index suppressions_org_email_uidx
  on public.suppressions (org_id, email);

-- RLS -------------------------------------------------------------------------

alter table public.email_events enable row level security;
alter table public.suppressions enable row level security;

-- email_events: append-only — SELECT + INSERT only (no UPDATE/DELETE), like
-- touchpoints.
create policy "email_events select own org"
  on public.email_events for select
  using (org_id = public.current_org_id());

create policy "email_events insert own org"
  on public.email_events for insert
  with check (org_id = public.current_org_id());

-- suppressions: SELECT + INSERT + DELETE (DELETE = un-suppress a returning
-- contact; closes the legacy "can't un-skip" gap). No UPDATE (a suppression is
-- create-or-delete, never edited).
create policy "suppressions select own org"
  on public.suppressions for select
  using (org_id = public.current_org_id());

create policy "suppressions insert own org"
  on public.suppressions for insert
  with check (org_id = public.current_org_id());

create policy "suppressions delete own org"
  on public.suppressions for delete
  using (org_id = public.current_org_id());
