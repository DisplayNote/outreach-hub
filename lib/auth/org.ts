/**
 * Resolve the caller's org / identity for RLS-scoped paths.
 *
 * On Azure these come straight from the Auth.js session (populated at first
 * login by provisionUser and pinned on the JWT) — no DB round-trip and no
 * dependency on Supabase auth. Signatures are unchanged from the retired
 * lib/supabase/org so every caller keeps working with only an import-path swap.
 *
 * Both throw (via requireSession) when there is no authenticated session, so a
 * failed lookup can never silently produce an RLS WITH CHECK violation later.
 */
import { requireSession } from '@/lib/auth/session';

/** The signed-in user: id + email plus their org_id and role. */
export interface CurrentUser {
  id: string;
  email: string;
  orgId: string;
  role: string;
}

export async function getCurrentOrgId(): Promise<string> {
  return (await requireSession()).orgId;
}

export async function getCurrentUser(): Promise<CurrentUser> {
  const s = await requireSession();
  return { id: s.userId, email: s.email, orgId: s.orgId, role: s.role };
}
