'use server';

/**
 * Phase 5 — read side of the AMD ("Mode B") dialler.
 *
 * The browser used to observe a run's `call_attempts` over Supabase Realtime;
 * post-migration it polls this server action instead (see
 * lib/dialler/amd/use-amd-run.ts). The query runs inside
 * `withRls(rlsCtxFromSession(await requireSession()), …)`, so the org-scoped
 * RLS policy on `call_attempts` does the org boundary for us — there is no
 * app-layer org filter here, exactly as the rest of lib/db/queries.ts.
 */
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { rlsCtxFromSession, requireSession } from '@/lib/auth/session';
import { withRls } from '@/lib/db/rls';
import { callAttempts } from '@/lib/db/schema';
import { drizzleRowToCallAttempt } from '@/lib/dialler/amd/row';
import type { CallAttempt } from '@/lib/dialler/amd/types';

const uuid = z.string().uuid();

/**
 * All attempts for a run, oldest-first. RLS scopes the result to the caller's
 * org, so a run id from another org simply yields an empty list. The runId is
 * validated as a uuid before it reaches the query.
 */
export async function getAmdRunAttempts(runId: string): Promise<CallAttempt[]> {
  const id = uuid.parse(runId);
  return withRls(rlsCtxFromSession(await requireSession()), async (tx) => {
    const rows = await tx
      .select()
      .from(callAttempts)
      .where(eq(callAttempts.runId, id))
      .orderBy(asc(callAttempts.createdAt));
    return rows.map(drizzleRowToCallAttempt);
  });
}
