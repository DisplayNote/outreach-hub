/**
 * Scheduled send trigger (PHASE_5_SPEC §1). CRON_SECRET-gated; driven by Vercel
 * Cron in prod (which calls with GET + `Authorization: Bearer <secret>`). Runs
 * the sender for the single configured org (CRON_ORG_ID) via the service-role
 * client — one global driver/token is one mailbox, so this does NOT fan out
 * across orgs (no-op when CRON_ORG_ID is unset). Local dev uses the "Run sender
 * now" Server Action instead.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getServerEnv } from '@/lib/env';
import { createServiceClient } from '@/lib/supabase/service';
import { runSenderAllOrgs } from '@/lib/email/cron';

export const runtime = 'nodejs';

/** Accept Vercel Cron's `Authorization: Bearer <secret>`, or an `x-cron-secret`
 * header. Header-only — never a query param (URLs leak into request logs). */
function authorized(request: NextRequest, secret: string | undefined): boolean {
  if (!secret) return false; // no secret configured → refuse (never run unauthenticated)
  if (request.headers.get('authorization') === `Bearer ${secret}`) return true;
  return request.headers.get('x-cron-secret') === secret;
}

async function handle(request: NextRequest): Promise<NextResponse> {
  const env = getServerEnv();
  if (!authorized(request, env.CRON_SECRET)) {
    return new NextResponse('unauthorized', { status: 401 });
  }
  try {
    const result = await runSenderAllOrgs(createServiceClient());
    return NextResponse.json({ ok: true, ...result });
  } catch (cause) {
    console.error('email run cron failed', cause);
    return new NextResponse('run failed', { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
