/**
 * Scheduled send trigger (PHASE_5_SPEC §1). CRON_SECRET-gated; driven by Vercel
 * Cron in prod (scheduled in vercel.json — weekdays 09:15 UTC; Vercel sends
 * GET + `Authorization: Bearer $CRON_SECRET` when that env var is set). Runs the
 * sender for the single configured org (CRON_ORG_ID) via the service-role
 * client — one global driver/token is one mailbox, so this does NOT fan out
 * across orgs (no-op when CRON_ORG_ID is unset). Local dev uses the "Run sender
 * now" Server Action instead.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getServerEnv } from '@/lib/env';
import { runSenderAllOrgs } from '@/lib/email/cron';
import { authorizeCron } from '@/lib/cron-auth';

export const runtime = 'nodejs';

async function handle(request: NextRequest): Promise<NextResponse> {
  const env = getServerEnv();
  if (!authorizeCron(request, env.CRON_SECRET)) {
    return new NextResponse('unauthorized', { status: 401 });
  }
  try {
    const result = await runSenderAllOrgs();
    // Surface per-contact send failures as a non-2xx so monitoring alerts: a
    // deploy misconfiguration (e.g. a missing Graph token) can make every send
    // fail while the route would otherwise look healthy with { ok: true }.
    const ok = result.errors === 0;
    return NextResponse.json({ ok, ...result }, { status: ok ? 200 : 500 });
  } catch (cause) {
    console.error('email run cron failed', cause);
    return new NextResponse('run failed', { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
