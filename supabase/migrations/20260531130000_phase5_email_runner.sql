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
-- load-bearing.
--
-- The FK is COMPOSITE on (sequence_id, org_id) → sequences(id, org_id), not a
-- plain id reference: RLS only checks the campaign's own org_id, so a plain id
-- FK would let a campaign point at ANOTHER org's sequence if the UUID were
-- known. sequences carries a unique (id, org_id) (Phase 2) to support this.
-- ON DELETE SET NULL (sequence_id) clears only that column when the sequence is
-- removed (org_id stays NOT NULL), matching the Phase-2 composite-FK pattern.
alter table public.campaigns add column sequence_id uuid;
alter table public.campaigns
  add constraint campaigns_sequence_id_fkey
  foreign key (sequence_id, org_id)
  references public.sequences (id, org_id) on delete set null (sequence_id);

create index campaigns_sequence_id_idx on public.campaigns (sequence_id);

-- Contact send bookkeeping ----------------------------------------------------

-- Last successful send: powers the "already sent today" guard + cadence.
-- (Also derivable from email_events, but denormalised here for cheap selection.)
alter table public.contacts
  add column last_emailed_at timestamptz;

-- Same-org composite-key targets so child rows below can enforce that an
-- email_event / suppression references a contact (or campaign) in its OWN org —
-- RLS only checks the child's org_id, so a plain id FK would let a known UUID
-- from another org be referenced. (Mirrors the Phase-2 (id, org_id) pattern.)
alter table public.contacts add constraint contacts_id_org_uk unique (id, org_id);
alter table public.campaigns add constraint campaigns_id_org_uk unique (id, org_id);

-- email_events — append-only per-message log ---------------------------------

create table public.email_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  contact_id uuid not null,
  campaign_id uuid,
  type text not null check (type in ('sent', 'reply', 'bounce')),
  provider text not null,
  message_id text,
  conversation_id text,
  in_reply_to text,
  subject text,
  sequence_day int,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- Same-org composite FKs (see contacts/campaigns unique keys above).
  foreign key (contact_id, org_id) references public.contacts (id, org_id) on delete cascade,
  foreign key (campaign_id, org_id) references public.campaigns (id, org_id) on delete set null (campaign_id)
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
  contact_id uuid,
  created_at timestamptz not null default now(),
  -- Same-org composite FK (nullable; cleared if the contact is removed).
  foreign key (contact_id, org_id) references public.contacts (id, org_id) on delete set null (contact_id)
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

-- Atomic send recording -------------------------------------------------------
-- The email is already sent (external, non-transactional). This commits the
-- contact advance + audit event + touchpoint together so a partial failure
-- can't leave a sent contact with no audit trail (or, conversely, advance
-- without recording). SECURITY INVOKER (default): the manual path runs under the
-- caller's RLS; the cron path uses the service role (bypasses RLS). All three
-- writes are idempotent on re-run (deduped on their unique keys).
create or replace function public.record_email_sent(
  p_org_id uuid,
  p_contact_id uuid,
  p_campaign_id uuid,
  p_provider text,
  p_message_id text,
  p_subject text,
  p_sequence_day int,
  p_next_sequence_day int,
  p_next_follow_up date,
  p_occurred_at timestamptz,
  p_now timestamptz
) returns void
  language plpgsql
as $$
begin
  update public.contacts
    set last_emailed_at = p_now,
        sequence_day = p_next_sequence_day,
        follow_up = p_next_follow_up
    where id = p_contact_id and org_id = p_org_id;

  insert into public.email_events
    (org_id, contact_id, campaign_id, type, provider, message_id, subject, sequence_day, occurred_at)
  values
    (p_org_id, p_contact_id, p_campaign_id, 'sent', p_provider, p_message_id, p_subject, p_sequence_day, p_occurred_at)
  on conflict (org_id, provider, message_id) do nothing;

  insert into public.touchpoints
    (org_id, contact_id, channel, note, occurred_at, legacy_id)
  values
    (p_org_id, p_contact_id, 'email', 'Sent: ' || coalesce(p_subject, ''), p_now,
     'email-sent-' || p_provider || '-' || p_message_id)
  on conflict (org_id, legacy_id) do nothing;
end;
$$;

-- Inbox-scan cursor (atomic) --------------------------------------------------
-- Advance organizations.settings.lastInboxScanAt without a read-merge-write
-- round trip: the single `||` jsonb concat updates only that key in one
-- statement, so a concurrent settings save can't be clobbered by a stale read.
-- p_at is stored verbatim as text (the scanner compares the ISO string), so the
-- value round-trips exactly. SECURITY INVOKER: manual path under the caller's
-- RLS (org UPDATE is restricted to the settings column), cron via service role.
create or replace function public.advance_inbox_scan_cursor(
  p_org_id uuid,
  p_at text
) returns void
  language sql
as $$
  update public.organizations
    set settings = settings || jsonb_build_object('lastInboxScanAt', p_at)
    where id = p_org_id;
$$;
