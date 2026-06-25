import { ConfidentialClientApplication } from '@azure/msal-node';
import { getSession, rlsCtxFromSession } from '@/lib/auth/session';
import { readGraphTokenRow, storeGraphTokens } from '@/lib/auth/graph-tokens';
import type { RlsContext } from '@/lib/db/rls';
import { getServerEnv } from '@/lib/env';
import { resolveDelegatedToken } from '@/lib/graph/refresh';

// ---------------------------------------------------------------------------
// App-only (client-credentials) token — for the CRON mailbox
// ---------------------------------------------------------------------------

/**
 * Application Microsoft Graph access token for the scheduled cron mailbox,
 * acquired via the OAuth client-credentials flow (MSAL
 * `acquireTokenByClientCredential`). This uses the app registration's
 * APPLICATION permissions (Mail.Send / Mail.Read granted by an admin) — there
 * is no signed-in user, so it suits the unattended ACA Job that sends/scans for
 * the single configured org (CRON_ORG_ID).
 *
 * The delegated path (`delegatedGraphToken`) is for the interactive "Run now"
 * actions and acts on behalf of the signed-in user; never mix the two.
 *
 * The token is cached in-module until ~2 minutes before expiry so a long-lived
 * cron process doesn't mint a fresh token on every call.
 */
let cachedAppToken: { token: string; expiresAtMs: number } | null = null;
let cachedMsalApp: ConfidentialClientApplication | null = null;

/** Skew before the real expiry at which we consider a cached token stale. */
const APP_TOKEN_REFRESH_SKEW_MS = 2 * 60 * 1000;

function msalApp(): ConfidentialClientApplication {
  if (cachedMsalApp) return cachedMsalApp;
  const env = getServerEnv();
  if (!env.AZURE_AD_CLIENT_ID || !env.AZURE_AD_CLIENT_SECRET || !env.AZURE_AD_TENANT_ID) {
    throw new Error(
      'appOnlyGraphToken: AZURE_AD_CLIENT_ID / AZURE_AD_CLIENT_SECRET / AZURE_AD_TENANT_ID must be set ' +
        'for the client-credentials (cron) Graph token.',
    );
  }
  cachedMsalApp = new ConfidentialClientApplication({
    auth: {
      clientId: env.AZURE_AD_CLIENT_ID,
      clientSecret: env.AZURE_AD_CLIENT_SECRET,
      authority: `https://login.microsoftonline.com/${env.AZURE_AD_TENANT_ID}`,
    },
  });
  return cachedMsalApp;
}

export async function appOnlyGraphToken(): Promise<string> {
  const now = Date.now();
  if (cachedAppToken && cachedAppToken.expiresAtMs - APP_TOKEN_REFRESH_SKEW_MS > now) {
    return cachedAppToken.token;
  }
  const result = await msalApp().acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });
  if (!result?.accessToken) {
    throw new Error('appOnlyGraphToken: MSAL returned no access token.');
  }
  // expiresOn is a Date (token expiry). Fall back to a conservative 5 min if absent.
  const expiresAtMs = result.expiresOn ? result.expiresOn.getTime() : now + 5 * 60 * 1000;
  cachedAppToken = { token: result.accessToken, expiresAtMs };
  return result.accessToken;
}

/** Test-only: reset the in-module app-token cache. */
export function __resetAppTokenCacheForTests(): void {
  cachedAppToken = null;
  cachedMsalApp = null;
}

// ---------------------------------------------------------------------------
// Delegated (on-behalf-of the signed-in user) token — with refresh-on-expiry
// ---------------------------------------------------------------------------

/**
 * The signed-in user's delegated Microsoft Graph access token (Mail.Send /
 * Mail.Read), for the manual "Run sender now" / "Scan inbox now" paths.
 *
 * The token is captured at login by the jwt callback and stored SERVER-SIDE in
 * public.user_graph_tokens (RLS-scoped to the user) — never on the Auth.js
 * session/JWT, so it can't leak via GET /api/auth/session. Here we read it back
 * via withRls scoped to the caller's own session.
 *
 * On expiry we exchange the stored refresh_token at the Entra token endpoint,
 * persist the rotated access/refresh/expiry via storeGraphTokens, and return the
 * fresh access token. If there is no refresh token or the exchange fails we
 * return null and the caller surfaces the re-auth prompt (GRAPH_UNAUTHORIZED).
 *
 * Returns null when there is no session or no usable delegated token (e.g. the
 * user signed in without the Mail scopes, or via the dev credentials provider).
 */
export async function delegatedGraphToken(): Promise<string | null> {
  const session = await getSession();
  if (!session) return null;
  const ctx: RlsContext = rlsCtxFromSession(session);

  const row = await readGraphTokenRow(ctx);
  if (!row) return null;

  const env = getServerEnv();
  // Without app credentials we can't refresh; fall back to the stored token only
  // if it's still valid (resolveDelegatedToken handles the expiry decision).
  if (!env.AZURE_AD_CLIENT_ID || !env.AZURE_AD_CLIENT_SECRET || !env.AZURE_AD_TENANT_ID) {
    const notExpired = row.expiresAtMs == null || row.expiresAtMs > Date.now();
    return row.accessToken && notExpired ? row.accessToken : null;
  }

  const resolved = await resolveDelegatedToken(row, {
    tenantId: env.AZURE_AD_TENANT_ID,
    clientId: env.AZURE_AD_CLIENT_ID,
    clientSecret: env.AZURE_AD_CLIENT_SECRET,
  });

  if (resolved.kind === 'current') return resolved.accessToken;
  if (resolved.kind === 'reauth') return null;

  // Persist the rotated tokens — best-effort: a transient DB write failure must
  // not fail an in-flight request that already holds a valid fresh token (the
  // next request just refreshes again).
  try {
    await storeGraphTokens(ctx, {
      accessToken: resolved.tokens.accessToken,
      refreshToken: resolved.tokens.refreshToken,
      expiresAt: resolved.tokens.expiresAt,
    });
  } catch (err) {
    console.error('delegatedGraphToken: failed to persist refreshed token (continuing)', err);
  }
  return resolved.tokens.accessToken;
}
