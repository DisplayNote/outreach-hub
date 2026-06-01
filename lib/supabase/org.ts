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

/** The signed-in user, resolved from auth + their `public.users` row. */
export interface CurrentUser {
  id: string;
  email: string;
  orgId: string;
  role: string;
}

/**
 * Resolve the signed-in user's identity: auth id + email plus their linked
 * `public.users` row (org_id, role). Used by the per-user settings action
 * (needs user_id + org_id for the RLS WITH CHECK), the admin gate (needs the
 * email to test the allowlist), and any per-user read path.
 *
 * Throws if the caller is unauthenticated or has no linked org row — never
 * returns a partial/guessed value.
 */
export async function getCurrentUser(): Promise<CurrentUser> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    throw new Error(`getCurrentUser: failed to resolve auth user: ${authError.message}`);
  }
  if (!user) {
    throw new Error('getCurrentUser: no authenticated user');
  }

  const { data, error } = await supabase
    .from('users')
    .select('org_id, role, email')
    .eq('id', user.id)
    .single();

  if (error) {
    throw new Error(`getCurrentUser: failed to load user row: ${error.message}`);
  }

  const row = data as { org_id: string; role: string; email: string } | null;
  if (!row?.org_id) {
    throw new Error('getCurrentUser: authenticated user has no org');
  }

  // Prefer the auth email (always present for an OAuth identity); fall back to
  // the mirrored users.email if the auth record somehow lacks it.
  const email = user.email ?? row.email;
  if (!email) {
    throw new Error('getCurrentUser: authenticated user has no email');
  }

  return { id: user.id, email, orgId: row.org_id, role: row.role };
}
