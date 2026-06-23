import { auth } from '@/lib/auth/config';

/**
 * The signed-in user's delegated Microsoft Graph access token (Mail.Send /
 * Mail.Read), for the manual "Run sender now" / "Scan inbox now" paths.
 *
 * INTERIM (Phase 4 adds refresh): the token is captured at login by the jwt
 * callback and surfaced on the Auth.js session; here we just read it back. There
 * is no refresh-on-expiry yet, so an expired token surfaces as a re-auth prompt
 * downstream (callers handle GRAPH_UNAUTHORIZED). Phase 4 replaces this with a
 * helper backed by durable token storage that refreshes via the stored refresh
 * token.
 *
 * Returns null when there is no session or no delegated token (e.g. the user
 * signed in without the Mail scopes, or via the dev credentials provider).
 */
export async function delegatedGraphToken(): Promise<string | null> {
  const session = await auth();
  return session?.accessToken ?? null;
}
