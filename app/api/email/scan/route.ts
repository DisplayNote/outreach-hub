/**
 * Scheduled inbox-scan trigger (PHASE_5_SPEC §1). CRON_SECRET-gated; scans every
 * org's inbox for replies/bounces via the service-role client. Local dev uses
 * the "Scan inbox now" Server Action instead.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getServerEnv } from '@/lib/env';
import { createServiceClient } from '@/lib/supabase/service';
import { scanInboxAllOrgs } from '@/lib/email/cron';

export const runtime = 'nodejs';

function authorized(request: NextRequest, secret: string | undefined): boolean {
  if (!secret) return false;
  const header = request.headers.get('x-cron-secret') ?? new URL(request.url).searchParams.get('secret');
  return header === secret;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
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
