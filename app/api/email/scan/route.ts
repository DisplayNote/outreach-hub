/**
 * Scheduled inbox-scan trigger (PHASE_5_SPEC §1). CRON_SECRET-gated; driven by
 * Vercel Cron (scheduled in vercel.json — every 30 min, 07:00–18:00 UTC on
 * weekdays; Vercel sends GET + `Authorization: Bearer $CRON_SECRET` when that
 * env var is set). Scans the single configured org's inbox (CRON_ORG_ID) for
 * replies/bounces via the service-role client — one global driver/token is one
 * mailbox, so this does NOT fan out across orgs (no-op when CRON_ORG_ID is
 * unset). Local dev uses the "Scan inbox now" Server Action instead.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getServerEnv } from '@/lib/env';
import { scanInboxAllOrgs } from '@/lib/email/cron';
import { authorizeCron } from '@/lib/cron-auth';

export const runtime = 'nodejs';

async function handle(request: NextRequest): Promise<NextResponse> {
  const env = getServerEnv();
  if (!authorizeCron(request, env.CRON_SECRET)) {
    return new NextResponse('unauthorized', { status: 401 });
  }
  try {
    const result = await scanInboxAllOrgs();
    // A configured org that couldn't be scanned (no mailbox resolved) is a
    // deploy misconfiguration, not a healthy run: surface it as non-2xx so
    // monitoring alerts. Otherwise replies/bounces silently stop processing and
    // the team keeps emailing people who replied or bounced. Mirrors run/route.
    const ok = result.skipped === 0;
    return NextResponse.json({ ok, ...result }, { status: ok ? 200 : 500 });
  } catch (cause) {
    console.error('email scan cron failed', cause);
    return new NextResponse('scan failed', { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
