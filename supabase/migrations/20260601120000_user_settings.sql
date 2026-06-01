-- Per-user settings: the settings overhaul splits the formerly org-wide
-- settings into a per-user tier (goals, follow-up rhythm, note snippets, the
-- caller's Telnyx dialling identity + dialler UX prefs) and a per-account tier
-- (which stays in organizations.settings, surfaced in the new /admin panel).
--
-- This table is the per-user store. It mirrors the organizations.settings shape
-- (a single loose jsonb blob) but is keyed by user, RLS-scoped so a user can
-- only ever read/write their own row. Reuses public.set_updated_at() from the
-- Phase 1 migration for the updated_at trigger.

create table public.user_settings (
  user_id uuid primary key references public.users(id) on delete cascade,
  -- Denormalised org_id so the INSERT/UPDATE WITH CHECK can pin the row to the
  -- caller's org (matches the per-table pattern elsewhere), and so per-org
  -- maintenance queries don't need a join.
  org_id uuid not null references public.organizations(id),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index user_settings_org_id_idx on public.user_settings (org_id);

create trigger set_user_settings_updated_at
  before update on public.user_settings
  for each row
  execute function public.set_updated_at();

-- RLS -------------------------------------------------------------------------
--
-- Self-scoped: a user reads/writes only their own row, and only within their
-- own org. We deliberately do NOT add column-level grants here (unlike
-- organizations, which has a sensitive `name` column): user_settings has no
-- non-`settings` column worth protecting, the WITH CHECK below already pins
-- user_id + org_id so they can't be reassigned, and a column-restricted UPDATE
-- grant would break PostgREST upsert (its ON CONFLICT DO UPDATE touches every
-- column in the payload, including user_id/org_id). Default Supabase grants +
-- these policies are sufficient.

alter table public.user_settings enable row level security;

create policy "user_settings select own"
  on public.user_settings for select
  using (user_id = auth.uid() and org_id = public.current_org_id());

create policy "user_settings insert own"
  on public.user_settings for insert
  with check (user_id = auth.uid() and org_id = public.current_org_id());

create policy "user_settings update own"
  on public.user_settings for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and org_id = public.current_org_id());

-- One-time owner backfill -----------------------------------------------------
--
-- Copy the existing per-user-tier keys from each org's settings into the org
-- OWNER's user_settings, so owners don't lose values they tuned before the
-- split. Members start clean (org defaults apply on read). The account-tier
-- keys are stripped out. Runs as the migration role (bypasses RLS). The stale
-- per-user keys remain harmlessly in organizations.settings; a follow-up
-- migration can strip them once this is verified in production.
insert into public.user_settings (user_id, org_id, settings)
select
  u.id,
  u.org_id,
  coalesce(o.settings, '{}'::jsonb)
    - 'defaultCountryCode'
    - 'seqSkipWeekends'
    - 'senderEmail'
    - 'inboxScanCursors'
from public.users u
join public.organizations o on o.id = u.org_id
where u.role = 'owner'
on conflict (user_id) do nothing;
