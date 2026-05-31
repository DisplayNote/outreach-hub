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

-- The sender's daily-cap accounting and the per-claim cap check both filter
-- contacts by (org_id, last_emailed_at >= start-of-day); index it so a claim is
-- a small range scan, not an org-wide contact scan.
create index contacts_org_last_emailed_idx
  on public.contacts (org_id, last_emailed_at);

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
-- the ON CONFLICT (org_id, email) arbiter for the upserts. The column is kept in
-- normalised (lower+trim) form by the trigger below, so it can serve as the
-- arbiter AND so dueContacts' `.in('email', <lowercased candidates>)` left-anti
-- join can never miss a row stored with different casing.
create unique index suppressions_org_email_uidx
  on public.suppressions (org_id, email);

-- Normalise the address at the DB boundary so the invariant holds for ANY writer
-- (our Server Actions already lower+trim, but a direct PostgREST insert under RLS
-- could otherwise store `User@Example.com` — which dueContacts' lowercased
-- left-anti join would then miss, letting a suppressed address still be emailed).
create or replace function public.suppressions_normalise_email()
  returns trigger
  language plpgsql
as $$
begin
  new.email := lower(btrim(new.email));
  return new;
end;
$$;

create trigger suppressions_normalise_email_trg
  before insert or update on public.suppressions
  for each row execute function public.suppressions_normalise_email();

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
-- Advance the scanner high-water without a read-merge-write round trip: the
-- single `||` jsonb concat updates only those keys in one statement, so a
-- concurrent settings save can't be clobbered by a stale read. The cursor is a
-- pair: lastInboxScanAt (the newest message's ISO timestamp, stored verbatim so
-- it round-trips) plus lastInboxScanIds (the message-ids seen AT that exact
-- timestamp). The next scan fetches `receivedAt >= lastInboxScanAt` and skips
-- the ids in lastInboxScanIds — so a boundary message is never re-processed,
-- while a genuinely new message sharing that millisecond (a different id) still
-- is. SECURITY INVOKER: manual path under the caller's RLS (org UPDATE is
-- restricted to the settings column), cron via the service role.
create or replace function public.advance_inbox_scan_cursor(
  p_org_id uuid,
  p_at text,
  p_ids jsonb
) returns void
  language sql
as $$
  update public.organizations
    set settings = settings
      || jsonb_build_object('lastInboxScanAt', p_at, 'lastInboxScanIds', p_ids)
    where id = p_org_id;
$$;

-- Due-contact selection (server-side) -----------------------------------------
-- The sender's candidate set, computed in ONE query so the runner fetches only
-- sendable rows up to the cap — instead of materialising the whole overdue queue
-- and filtering in app code (which both bloats the suppression `in(...)` and,
-- when limiting client-side, starves the batch if the first N are suppressed or
-- unlinked). A row is due when the contact is enrolled (follow_up set & due),
-- non-terminal, has an email, hasn't been emailed today, its campaign links a
-- sequence, that sequence has a step at the contact's current sequence_day, and
-- the address isn't suppressed. Ordered most-overdue first; `p_limit` NULL = all
-- (the queue page), 0 = none. `next_day_offset` is the next step's offset (for
-- follow-up scheduling) or NULL at the last step; `has_template` lets the runner
-- skip+surface a step with no template rather than send blank mail.
-- SECURITY INVOKER: manual path under the caller's RLS, cron via service role;
-- p_org_id scopes either way.
create or replace function public.due_email_contacts(
  p_org_id uuid,
  p_today date,
  p_limit int
) returns table (
  contact jsonb,
  campaign_id uuid,
  sequence_day int,
  next_day_offset int,
  has_template boolean,
  template_subject text,
  template_body text
)
  language sql
  stable
as $$
  select
    to_jsonb(c) as contact,
    c.campaign_id,
    c.sequence_day,
    (select min(ss2.day_offset)
       from public.sequence_steps ss2
      where ss2.sequence_id = cam.sequence_id
        and ss2.org_id = c.org_id
        and ss2.day_offset > c.sequence_day
        and ss2.channel = 'email') as next_day_offset,
    (step.template_id is not null) as has_template,
    t.subject as template_subject,
    t.body as template_body
  from public.contacts c
  join public.campaigns cam
    on cam.id = c.campaign_id and cam.org_id = c.org_id and cam.sequence_id is not null
  -- LATERAL + limit 1 picks EXACTLY ONE email step at the contact's day_offset
  -- (lowest step_order, deterministically). The schema only enforces unique
  -- step_order, not unique day_offset, so a plain join could return duplicate due
  -- rows if a sequence had two email steps at the same offset.
  join lateral (
    select ss.template_id, ss.step_order
      from public.sequence_steps ss
     where ss.sequence_id = cam.sequence_id and ss.org_id = c.org_id
       and ss.day_offset = c.sequence_day and ss.channel = 'email'
     order by ss.step_order asc
     limit 1
  ) step on true
  left join public.templates t
    on t.id = step.template_id and t.org_id = c.org_id
  where c.org_id = p_org_id
    and c.follow_up is not null
    and c.follow_up <= p_today
    and c.email is not null
    and c.status not in ('notinterested', 'bounced', 'meeting')
    and (c.last_emailed_at is null or c.last_emailed_at < (p_today::timestamp at time zone 'UTC'))
    and not exists (
      select 1 from public.suppressions s
       where s.org_id = c.org_id and s.email = lower(btrim(c.email))
    )
  order by c.follow_up asc, c.sequence_day asc
  limit p_limit;
$$;

-- Atomic send claim ----------------------------------------------------------
-- Claim a single contact for sending: set last_emailed_at = p_now in ONE
-- conditional UPDATE that re-checks the SAME stop conditions as the due query
-- (not-sent-today, non-terminal status, AND not suppressed) AND enforces the
-- daily cap. The row lock serialises overlapping runs, and re-checking inside the
-- update closes the race where a late reply/bounce/manual suppression lands
-- between selection and send. Enforcing the cap HERE (count of contacts already
-- claimed today < p_daily_goal) — rather than once per run before claiming — is
-- what stops two concurrent runs from collectively exceeding the goal via their
-- over-fetch buffers. Returns whether this call won. SECURITY INVOKER.
create or replace function public.claim_email_send(
  p_org_id uuid,
  p_contact_id uuid,
  p_today date,
  p_now timestamptz,
  p_daily_goal int
) returns boolean
  language plpgsql
as $$
declare
  claimed_rows int;
  day_start timestamptz := p_today::timestamp at time zone 'UTC';
begin
  -- Serialise claims PER ORG for the duration of this transaction, so the daily
  -- cap is evaluated exactly: without it, two overlapping claims for DIFFERENT
  -- contact rows could both read the cap count before either's update is visible
  -- and both proceed, letting the org exceed p_daily_goal. The xact lock releases
  -- when this single-statement RPC transaction commits.
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text, 0));

  -- Re-check the FULL due_email_contacts predicate under the row lock, not just
  -- status/last_emailed/suppression: if the contact was unenrolled, had its
  -- follow_up pushed to the future, its email cleared, or its campaign sequence
  -- unlinked / current email step removed between selection and claim, the
  -- UPDATE must match 0 rows so the runner doesn't send a stale row.
  update public.contacts c
     set last_emailed_at = p_now
   where c.id = p_contact_id
     and c.org_id = p_org_id
     and c.email is not null
     and c.follow_up is not null
     and c.follow_up <= p_today
     and c.status not in ('notinterested', 'bounced', 'meeting')
     and (c.last_emailed_at is null or c.last_emailed_at < day_start)
     and not exists (
       select 1 from public.suppressions s
        where s.org_id = c.org_id and s.email = lower(btrim(c.email))
     )
     and exists (
       select 1
         from public.campaigns cam
         join public.sequence_steps ss
           on ss.sequence_id = cam.sequence_id and ss.org_id = c.org_id
          and ss.day_offset = c.sequence_day and ss.channel = 'email'
        where cam.id = c.campaign_id and cam.org_id = c.org_id and cam.sequence_id is not null
     )
     -- Daily cap, enforced atomically across runs: contacts already claimed today.
     and (
       select count(*) from public.contacts cc
        where cc.org_id = p_org_id and cc.last_emailed_at >= day_start
     ) < p_daily_goal;
  get diagnostics claimed_rows = row_count;
  return claimed_rows > 0;
end;
$$;

-- Accurate "how many are due" count (same predicate as due_email_contacts, post
-- suppression/sequence/step filtering) so runSender().remaining is real, not an
-- over-estimate that counts suppressed/unlinked rows.
create or replace function public.count_due_email_contacts(
  p_org_id uuid,
  p_today date
) returns integer
  language sql
  stable
as $$
  -- Count each contact ONCE: the email-step requirement is an EXISTS, not a join,
  -- so duplicate email steps at the same day_offset can't inflate the count
  -- (matches the single-step LATERAL selection in due_email_contacts).
  select count(*)::int
  from public.contacts c
  join public.campaigns cam
    on cam.id = c.campaign_id and cam.org_id = c.org_id and cam.sequence_id is not null
  where c.org_id = p_org_id
    and c.follow_up is not null
    and c.follow_up <= p_today
    and c.email is not null
    and c.status not in ('notinterested', 'bounced', 'meeting')
    and (c.last_emailed_at is null or c.last_emailed_at < (p_today::timestamp at time zone 'UTC'))
    and exists (
      select 1 from public.sequence_steps ss
       where ss.sequence_id = cam.sequence_id and ss.org_id = c.org_id
         and ss.day_offset = c.sequence_day and ss.channel = 'email'
    )
    and not exists (
      select 1 from public.suppressions s
       where s.org_id = c.org_id and s.email = lower(btrim(c.email))
    );
$$;
