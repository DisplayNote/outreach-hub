import { getSession, rlsCtxFromSession } from '@/lib/auth/session';
import { readGraphAccessToken } from '@/lib/auth/graph-tokens';

/**
 * The signed-in user's delegated Microsoft Graph access token (Mail.Send /
 * Mail.Read), for the manual "Run sender now" / "Scan inbox now" paths.
 *
 * The token is captured at login by the jwt callback and stored SERVER-SIDE in
 * public.user_graph_tokens (RLS-scoped to the user) — never on the Auth.js
 * session/JWT, so it can't leak via GET /api/auth/session. Here we read it back
 * via withRls scoped to the caller's own session.
 *
 * INTERIM (Phase 4 adds refresh): no refresh-on-expiry yet — an absent/expired
 * token returns null and callers surface the re-auth prompt (GRAPH_UNAUTHORIZED).
 *
 * Returns null when there is no session or no (unexpired) delegated token (e.g.
 * the user signed in without the Mail scopes, or via the dev credentials provider).
 */
export async function delegatedGraphToken(): Promise<string | null> {
  const session = await getSession();
  if (!session) return null;
  return readGraphAccessToken(rlsCtxFromSession(session));
}
