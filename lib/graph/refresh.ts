/**
 * Pure delegated-token refresh decision logic, with NO Auth.js / next-auth /
 * DB imports, so it is unit-testable in isolation (next-auth's server entry
 * fails to load under vitest). lib/graph/token.ts wires this to the session and
 * the user_graph_tokens store.
 */

/** Treat a delegated token as expired this far before its real expiry. */
export const DELEGATED_TOKEN_SKEW_MS = 60 * 1000;

export interface StoredGraphToken {
  accessToken: string | null;
  refreshToken: string | null;
  /** Epoch milliseconds, or null when unknown. */
  expiresAtMs: number | null;
}

export interface RefreshedTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch seconds (Entra `expires_in` applied to now), or null. */
  expiresAt: number | null;
}

/** Minimal fetch shape we depend on — narrow so tests can supply a mock. */
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export type ResolveResult =
  | { kind: 'current'; accessToken: string }
  | { kind: 'refreshed'; tokens: RefreshedTokens }
  | { kind: 'reauth' };

/**
 * Decide whether the stored delegated token is usable as-is, and if not, attempt
 * a refresh-token exchange at the Entra token endpoint. Pure w.r.t. I/O except
 * the injected `fetcher`, so it is unit-testable with a mock token endpoint.
 *
 * Returns:
 *   - { kind: 'current', accessToken }   — stored token still valid
 *   - { kind: 'refreshed', tokens }      — exchanged a new token
 *   - { kind: 'reauth' }                 — no usable token; caller re-auths
 */
export async function resolveDelegatedToken(
  stored: StoredGraphToken,
  cfg: { tenantId: string; clientId: string; clientSecret: string; scope?: string },
  deps: { now?: () => number; fetcher?: Fetcher } = {},
): Promise<ResolveResult> {
  const now = deps.now ? deps.now() : Date.now();
  const fetcher = deps.fetcher ?? fetch;

  const notExpired = stored.expiresAtMs == null || stored.expiresAtMs - DELEGATED_TOKEN_SKEW_MS > now;
  if (stored.accessToken && notExpired) {
    return { kind: 'current', accessToken: stored.accessToken };
  }

  // Expired (or no access token) — only path forward is a refresh-token exchange.
  if (!stored.refreshToken) return { kind: 'reauth' };

  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: stored.refreshToken,
    scope: cfg.scope ?? 'openid profile email offline_access User.Read Mail.Send Mail.Read',
  });

  let res: Response;
  try {
    res = await fetcher(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch {
    return { kind: 'reauth' };
  }
  if (!res.ok) return { kind: 'reauth' };

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { kind: 'reauth' };
  }
  const data = json as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
  if (typeof data.access_token !== 'string' || data.access_token.length === 0) {
    return { kind: 'reauth' };
  }
  const expiresAt = typeof data.expires_in === 'number' ? Math.floor(now / 1000) + data.expires_in : null;
  return {
    kind: 'refreshed',
    tokens: {
      accessToken: data.access_token,
      // Entra may omit refresh_token on refresh; null means "keep prior" (storeGraphTokens coalesces).
      refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : null,
      expiresAt,
    },
  };
}
