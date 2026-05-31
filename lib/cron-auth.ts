import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string compare. Hashes both inputs to fixed-length digests first
 * so the comparison time leaks neither the secret's content NOR its length (a
 * plain `===`, or a length-guarded timingSafeEqual, would leak prefix/length
 * timing on these public cron routes).
 */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Authorize a Vercel Cron (or manual) call to the scheduled email routes.
 * Accepts the secret via `Authorization: Bearer <secret>` or an `x-cron-secret`
 * header — HEADER ONLY, never a query param (URLs leak into request logs). The
 * comparison is constant-time. Returns false when no secret is configured (the
 * routes then refuse rather than run unauthenticated).
 */
export function authorizeCron(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const auth = request.headers.get('authorization');
  const provided = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : request.headers.get('x-cron-secret');
  if (!provided) return false;
  return safeEqual(provided, secret);
}
