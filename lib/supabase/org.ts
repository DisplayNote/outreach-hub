/**
 * Resolve the caller's org id for write paths.
 *
 * INSERT policies on the Phase 1 tables enforce
 * `org_id = public.current_org_id()` via WITH CHECK, so every row we create
 * must carry the caller's org_id explicitly (PostgREST can't see the SQL
 * default). We read it from `public.users` (RLS-scoped to the caller's own
 * org), which is equivalent to `public.current_org_id()` but expressible
 * through PostgREST.
 *
 * Throws if the caller is unauthenticated or has no linked org row — never
 * returns an empty/guessed value, so a failed lookup can't silently produce an
 * RLS WITH CHECK violation later.
 */
import { createClient } from '@/lib/supabase/server';

export async function getCurrentOrgId(): Promise<string> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    throw new Error(`getCurrentOrgId: failed to resolve auth user: ${authError.message}`);
  }
  if (!user) {
    throw new Error('getCurrentOrgId: no authenticated user');
  }

  const { data, error } = await supabase
    .from('users')
    .select('org_id')
    .eq('id', user.id)
    .single();

  if (error) {
    throw new Error(`getCurrentOrgId: failed to load org for user: ${error.message}`);
  }

  const orgId = (data as { org_id: string } | null)?.org_id;
  if (!orgId) {
    throw new Error('getCurrentOrgId: authenticated user has no org');
  }

  return orgId;
}
