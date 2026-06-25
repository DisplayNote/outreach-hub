/**
 * Scheduled send trigger (PHASE_5_SPEC §1). CRON_SECRET-gated; driven by an
 * Azure Container Apps Job (infra/azure_apps.tf) that POSTs this route at the
 * env-internal ingress URL with `Authorization: Bearer $CRON_SECRET` on the
 * `15 9 * * 1-5` schedule (curl -fsS, so a non-2xx fails the job loudly). Runs
 * the sender for the single configured org (CRON_ORG_ID) via withServiceRls +
 * the app-only Graph token — one mailbox, so this does NOT fan out across orgs.
 * CRON_ORG_ID unset: no-op (returns 0 orgs) in dev; throws and fails the job in
 * production. Local dev uses the "Run sender now" Server Action instead.
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
    // A configured org that couldn't be sent for (no resolvable sender mailbox)
    // is a deploy misconfiguration, not a healthy run — fail the job so it alerts
    // (mirrors scan/route). `errors` covers per-contact send/persist failures.
    const ok = result.errors === 0 && result.skipped === 0;
    return NextResponse.json({ ok, ...result }, { status: ok ? 200 : 500 });
  } catch (cause) {
    console.error('email run cron failed', cause);
    return new NextResponse('run failed', { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
