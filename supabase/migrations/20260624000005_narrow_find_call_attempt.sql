-- Narrow find_call_attempt to return only the columns the webhook discovery path
-- actually needs (id, org_id). The original SECURITY DEFINER returning select *
-- on public.call_attempts exposed the full row to any app_user code path that
-- could call the function, regardless of which org owned the row. The webhook only
-- uses the org_id to resolve which org context to use for subsequent writes; full
-- row details are then fetched via a normal org-scoped query under withServiceRls.

create or replace function public.find_call_attempt(
  p_call_control_id text default null,
  p_id uuid default null
)
  returns table (id uuid, org_id uuid)
  language sql
  security definer
  set search_path = public
as $$
  select id, org_id
    from public.call_attempts
   where (p_call_control_id is not null and call_control_id = p_call_control_id)
      or (p_id is not null and id = p_id)
   limit 1
$$;
