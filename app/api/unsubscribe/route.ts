/**
 * Public one-click unsubscribe (compliance). No session: the request is
 * authenticated by the HMAC-signed token in the URL (see lib/email/unsubscribe),
 * which carries the org + email.
 *
 *  - GET  → a human (or a mail scanner / link-prefetcher) opened the footer link.
 *           GET is SAFE — it only renders a confirmation page with a button; it
 *           does NOT write. This stops corporate safe-link scanners (Defender
 *           SafeLinks, Proofpoint, Mimecast) and prefetchers from silently
 *           unsubscribing a recipient who never clicked.
 *  - POST → the actual opt-out: the RFC 8058 one-click `List-Unsubscribe-Post`
 *           flow, and the confirmation page's button. Records an `unsubscribed`
 *           suppression (service-role, scoped to the token's org) AND stops the
 *           matching contact's sequence, so a later email edit can't un-suppress.
 *
 * Idempotent: re-unsubscribing is a no-op upsert.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { getServerEnv } from '@/lib/env';
import { withServiceRls } from '@/lib/db/rls-service';
import { contacts, suppressions } from '@/lib/db/schema';
import { verifyUnsubscribeToken } from '@/lib/email/unsubscribe';
import { escapeLike } from '@/lib/db/like';

export const runtime = 'nodejs';

// Statuses the sender's anti-join already treats as terminal; we never overwrite
// a stronger pipeline state (a booked meeting, a hard bounce) with the opt-out.
const TERMINAL_STATUSES = ['notinterested', 'bounced', 'meeting'] as const;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function page(title: string, message: string, status: number, formAction?: string): NextResponse {
  const form = formAction
    ? `<form method="post" action="${escapeHtml(formAction)}">
<button type="submit" style="font:inherit;padding:.6rem 1rem;border:0;border-radius:6px;background:#222;color:#fff;cursor:pointer">Confirm unsubscribe</button></form>`
    : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#222">
<h1 style="font-size:1.25rem">${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${form}</body></html>`;
  return new NextResponse(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });
}

/** Resolve the token claim, or a reason it failed. */
function claimFrom(request: NextRequest): { secret: string; claim: { orgId: string; email: string } | null } | null {
  const env = getServerEnv();
  if (!env.UNSUBSCRIBE_SECRET) return null; // feature not configured
  const token = request.nextUrl.searchParams.get('token');
  return { secret: env.UNSUBSCRIBE_SECRET, claim: token ? verifyUnsubscribeToken(token, env.UNSUBSCRIBE_SECRET) : null };
}

/** Record the suppression and stop the contact's sequence. Returns ok. */
async function applyUnsubscribe(claim: { orgId: string; email: string }): Promise<boolean> {
  const email = claim.email.toLowerCase();
  // The org comes from the HMAC-signed token (trusted), so withServiceRls scopes
  // the writes to that org's rows.
  try {
    await withServiceRls(claim.orgId, async (tx) => {
      // ON CONFLICT (org_id,email) DO NOTHING — re-unsubscribing is idempotent.
      await tx
        .insert(suppressions)
        // suppressions.createdAt is NOT NULL with a DB-side `default now()`; the
        // schema omits the Drizzle default, so supply it explicitly.
        .values({ orgId: claim.orgId, email, reason: 'unsubscribed', createdAt: sql`now()` })
        .onConflictDoNothing({ target: [suppressions.orgId, suppressions.email] });

      // Address-level suppression alone would silently stop matching if the
      // contact's email is later edited — so also mark the matching contact(s)
      // terminal so the opt-out survives an address change. Non-fatal: the
      // suppression is the primary guard. Never overwrite an already-terminal/
      // stronger status.
      try {
        await tx
          .update(contacts)
          .set({ status: 'notinterested' })
          .where(
            and(
              eq(contacts.orgId, claim.orgId),
              sql`${contacts.email} ilike ${escapeLike(email)}`,
              notInArray(contacts.status, [...TERMINAL_STATUSES]),
            ),
          );
      } catch (contactError) {
        console.error('unsubscribe: failed to stop contact sequence', contactError);
      }
    });
  } catch (error) {
    console.error('unsubscribe: failed to record suppression', error);
    return false;
  }
  return true;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const ctx = claimFrom(request);
  if (!ctx) return page('Not available', 'Unsubscribe is not configured.', 404);
  if (!ctx.claim) return page('Invalid link', 'This unsubscribe link is invalid or has expired.', 400);
  // SAFE GET: confirm intent with a button that POSTs — no write here.
  return page(
    'Unsubscribe',
    'Click the button below to stop receiving these emails.',
    200,
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ctx = claimFrom(request);
  // Mirror the GET error pages so a browser form-submit never shows a blank page.
  // One-click List-Unsubscribe-Post clients ignore the body regardless.
  if (!ctx) return page('Not available', 'Unsubscribe is not configured.', 404);
  if (!ctx.claim) return page('Invalid link', 'This unsubscribe link is invalid or has expired.', 400);
  const ok = await applyUnsubscribe(ctx.claim);
  if (!ok) return new NextResponse(null, { status: 500 });
  return page('Unsubscribed', 'You will no longer receive these emails. You can close this page.', 200);
}
