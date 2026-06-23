/**
 * Stateless unsubscribe tokens (compliance: a one-click opt-out for cold
 * outreach — CAN-SPAM / GDPR / PECR). A token is a signed `{orgId,email}` pair,
 * so the public `/api/unsubscribe` route can authenticate an opt-out with no
 * prior DB lookup and no user session: it trusts the HMAC, not the caller.
 *
 * Format: `base64url(payload) . base64url(HMAC-SHA256(secret, payload))` where
 * payload is `${orgId}:${normalisedEmail}`. orgId is a UUID and email never
 * contains ':' , so splitting on the first ':' is unambiguous.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface UnsubscribeConfig {
  /** Absolute app origin, e.g. https://outreach.displaynote.com (no trailing slash). */
  baseUrl: string;
  /** HMAC signing secret (UNSUBSCRIBE_SECRET). */
  secret: string;
}

type EnvRecord = Record<string, string | undefined>;

/**
 * Resolve the unsubscribe config from env, or null when the feature isn't
 * configured (no APP_BASE_URL / UNSUBSCRIBE_SECRET). Null = sends go out without
 * an unsubscribe link/header rather than failing — the caller decides whether
 * that's acceptable for the environment (it is not, for production cold email).
 */
export function getUnsubscribeConfig(env: EnvRecord = process.env): UnsubscribeConfig | null {
  const baseUrl = env.APP_BASE_URL;
  const secret = env.UNSUBSCRIBE_SECRET;
  if (!baseUrl || !secret) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ''), secret };
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Sign an `{orgId,email}` pair into an opaque, URL-safe unsubscribe token. */
export function signUnsubscribeToken(orgId: string, email: string, secret: string): string {
  // Enforce the separator invariant the verify-side split relies on: orgId is a
  // UUID in practice, but guard so a future caller passing a ':'-bearing id can't
  // make the token round-trip to a DIFFERENT {orgId,email} than was signed.
  if (orgId.includes(':')) {
    throw new Error('signUnsubscribeToken: orgId must not contain ":"');
  }
  const payload = `${orgId}:${normaliseEmail(email)}`;
  const sig = createHmac('sha256', secret).update(payload).digest();
  return `${Buffer.from(payload).toString('base64url')}.${sig.toString('base64url')}`;
}

/**
 * Verify a token's signature and return its `{orgId,email}`, or null when the
 * token is malformed, truncated, or its signature doesn't match `secret`.
 * Constant-time signature comparison.
 */
export function verifyUnsubscribeToken(
  token: string,
  secret: string,
): { orgId: string; email: string } | null {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;

  let payload: string;
  let provided: Buffer;
  try {
    payload = Buffer.from(token.slice(0, dot), 'base64url').toString('utf8');
    provided = Buffer.from(token.slice(dot + 1), 'base64url');
  } catch {
    return null;
  }

  const expected = createHmac('sha256', secret).update(payload).digest();
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }

  const sep = payload.indexOf(':');
  if (sep <= 0 || sep === payload.length - 1) return null;
  const orgId = payload.slice(0, sep);
  const email = payload.slice(sep + 1);
  if (!orgId || !email) return null;
  return { orgId, email };
}

/** Build the unsubscribe URL (and `List-Unsubscribe` headers) for a recipient. */
export function buildUnsubscribe(
  orgId: string,
  email: string,
  cfg: UnsubscribeConfig,
): { url: string; headers: Record<string, string> } {
  const token = signUnsubscribeToken(orgId, email, cfg.secret);
  const url = `${cfg.baseUrl}/api/unsubscribe?token=${encodeURIComponent(token)}`;
  return {
    url,
    headers: {
      // RFC 2369 + RFC 8058 one-click. A visible footer link is added to the
      // body too, since many clients don't surface the header.
      'List-Unsubscribe': `<${url}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}
