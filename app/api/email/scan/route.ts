/**
 * Scheduled inbox-scan trigger (PHASE_5_SPEC §1). CRON_SECRET-gated; driven by
 * Vercel Cron (GET + `Authorization: Bearer <secret>`). Scans every org's inbox
 * for replies/bounces via the service-role client. Local dev uses the "Scan
 * inbox now" Server Action instead.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getServerEnv } from '@/lib/env';
import { createServiceClient } from '@/lib/supabase/service';
import { scanInboxAllOrgs } from '@/lib/email/cron';

export const runtime = 'nodejs';

/** Accept Vercel Cron's `Authorization: Bearer <secret>`, or an `x-cron-secret`
 * header. Header-only — never a query param (URLs leak into request logs). */
function authorized(request: NextRequest, secret: string | undefined): boolean {
  if (!secret) return false;
  if (request.headers.get('authorization') === `Bearer ${secret}`) return true;
  return request.headers.get('x-cron-secret') === secret;
}

async function handle(request: NextRequest): Promise<NextResponse> {
  const env = getServerEnv();
  if (!authorized(request, env.CRON_SECRET)) {
    return new NextResponse('unauthorized', { status: 401 });
  }
  try {
    const result = await scanInboxAllOrgs(createServiceClient());
    return NextResponse.json({ ok: true, ...result });
  } catch (cause) {
    console.error('email scan cron failed', cause);
    return new NextResponse('scan failed', { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
