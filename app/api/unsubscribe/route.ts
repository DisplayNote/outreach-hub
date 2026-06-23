/**
 * Public one-click unsubscribe (compliance). No session: the request is
 * authenticated by the HMAC-signed token in the URL (see lib/email/unsubscribe),
 * which carries the org + email. A valid token adds an `unsubscribed` suppression
 * via the service-role client (scoped to the org from the token), so the sender's
 * due-contacts anti-join stops emailing that address.
 *
 *  - GET  → a person clicked the footer link; add the suppression, show a page.
 *  - POST → RFC 8058 List-Unsubscribe-Post one-click; add the suppression, 200.
 *
 * Idempotent: re-unsubscribing is a no-op upsert.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getServerEnv } from '@/lib/env';
import { createServiceClient } from '@/lib/supabase/service';
import { verifyUnsubscribeToken } from '@/lib/email/unsubscribe';

export const runtime = 'nodejs';

function page(title: string, message: string, status: number): NextResponse {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#222">
<h1 style="font-size:1.25rem">${title}</h1><p>${message}</p></body></html>`;
  return new NextResponse(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

async function unsubscribe(request: NextRequest): Promise<{ ok: boolean; status: number }> {
  const env = getServerEnv();
  if (!env.UNSUBSCRIBE_SECRET) {
    // Feature not configured — don't pretend it worked.
    return { ok: false, status: 404 };
  }
  const token = request.nextUrl.searchParams.get('token');
  if (!token) return { ok: false, status: 400 };

  const claim = verifyUnsubscribeToken(token, env.UNSUBSCRIBE_SECRET);
  if (!claim) return { ok: false, status: 400 };

  const supabase = createServiceClient();
  const { error } = await supabase.from('suppressions').upsert(
    { org_id: claim.orgId, email: claim.email.toLowerCase(), reason: 'unsubscribed' },
    { onConflict: 'org_id,email', ignoreDuplicates: true },
  );
  if (error) {
    console.error('unsubscribe: failed to record suppression', error);
    return { ok: false, status: 500 };
  }
  return { ok: true, status: 200 };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { ok, status } = await unsubscribe(request);
  if (ok) {
    return page('Unsubscribed', 'You will no longer receive these emails. You can close this page.', 200);
  }
  if (status === 400) return page('Invalid link', 'This unsubscribe link is invalid or has expired.', 400);
  if (status === 404) return page('Not available', 'Unsubscribe is not configured.', 404);
  return page('Something went wrong', 'Please try again later.', 500);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { status } = await unsubscribe(request);
  // One-click clients don't render a body; status is what matters.
  return new NextResponse(null, { status });
}
