-- Dialler (AMD) write access under RLS.
--
-- On Supabase the AMD writes (startAmdRun / placeAmdCall / the Telnyx webhook's
-- attempt updates + event/touchpoint inserts) went through the service-role
-- client, which has BYPASSRLS — so the Phase-4 migration only ever created
-- SELECT policies on call_runs / call_attempts / call_events. On Azure the app
-- connects as the NON-owner app_user (RLS is enforced), and those writes now run
-- under withServiceRls(orgId) (the org GUC set). Without INSERT/UPDATE policies
-- every dialler write — including every inbound webhook event — is silently
-- denied. Add the org-scoped write policies the app_user path needs.

create policy "call_runs insert own org" on public.call_runs
  for insert with check (org_id = public.current_org_id());
create policy "call_runs update own org" on public.call_runs
  for update using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

create policy "call_attempts insert own org" on public.call_attempts
  for insert with check (org_id = public.current_org_id());
create policy "call_attempts update own org" on public.call_attempts
  for update using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

create policy "call_events insert own org" on public.call_events
  for insert with check (org_id = public.current_org_id());
-- (touchpoints already has an org-scoped INSERT policy from the Phase-1 schema.)

-- Cross-org discovery read for the inbound webhook: it must find the
-- call_attempts row by Telnyx call_control_id (or attempt id) BEFORE it knows
-- which org the event belongs to, so an org-scoped SELECT (current_org_id() is
-- NULL with no GUC) returns nothing. This SECURITY DEFINER lookup (owned by the
-- migration owner) bypasses RLS for exactly that one read; every subsequent
-- write still derives org_id from the returned row and runs org-scoped under
-- withServiceRls(orgId). Mirrors the provision_user definer pattern.
create or replace function public.find_call_attempt(
  p_call_control_id text default null,
  p_id uuid default null
)
  returns setof public.call_attempts
  language sql
  security definer
  set search_path = public
as $$
  select *
    from public.call_attempts
   where (p_call_control_id is not null and call_control_id = p_call_control_id)
      or (p_id is not null and id = p_id)
   limit 1
$$;

grant execute on function public.find_call_attempt(text, uuid) to app_user;
