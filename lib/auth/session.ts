import { auth } from '@/lib/auth/config';
import type { RlsContext } from '@/lib/db/rls';

/**
 * The application's view of an authenticated session. Carries exactly the
 * identity RLS + the admin gate need: the user id and org id (→ RLS GUCs via
 * rlsCtxFromSession), plus email + role. Sourced from the Auth.js JWT, which
 * the jwt callback populated at first login via provisionUser.
 */
export interface AppSession {
  userId: string;
  email: string;
  orgId: string;
  role: string;
}

/** The current session, or null when unauthenticated / not yet provisioned. */
export async function getSession(): Promise<AppSession | null> {
  const s = await auth();
  if (!s?.user?.id || !s.user.orgId) return null;
  return {
    userId: s.user.id,
    email: s.user.email ?? '',
    orgId: s.user.orgId,
    role: s.user.role ?? 'member',
  };
}

/** As getSession, but throws when there is no authenticated session. */
export async function requireSession(): Promise<AppSession> {
  const s = await getSession();
  if (!s) throw new Error('requireSession: no authenticated session');
  return s;
}

/** Map a session to the RLS context withRls consumes ({ userId, orgId }). */
export function rlsCtxFromSession(s: AppSession): RlsContext {
  return { userId: s.userId, orgId: s.orgId };
}
