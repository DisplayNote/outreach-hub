-- Fix find_call_attempt non-determinism when both args are non-null.
-- The original OR let both predicates match simultaneously, making LIMIT 1
-- arbitrary. Give p_id explicit precedence: when it is set use it alone;
-- otherwise fall through to p_call_control_id. The calling pattern in
-- runtime.ts always passes exactly one non-null arg, but the function should
-- be deterministic regardless.

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
   where (p_id is not null and id = p_id)
      or (p_id is null and p_call_control_id is not null and call_control_id = p_call_control_id)
   limit 1
$$;
