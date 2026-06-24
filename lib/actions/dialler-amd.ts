'use server';

/**
 * Phase 4 Server Actions for the AMD dialler ("Mode B").
 *
 * These are the app-initiated control-plane entry points: start a run, place an
 * AMD call, hang up / cancel an attempt, pause-stop a run. All call-table writes
 * run as a TRUSTED SERVICE PATH (withServiceRls) — the same privilege the legacy
 * service-role client carried — with org membership resolved from the caller's
 * session (getCurrentOrgId) and every row scoped to that org, so the browser
 * never mutates call state directly (DECISION 4.1).
 *
 * withServiceRls sets app.org_id only (userId = null): the org-scoped RLS
 * policies on call_runs / call_attempts / contacts apply for the resolved org,
 * which is why each query still carries an explicit `org_id` predicate — that is
 * the cross-org IDOR guard, not a duplicate of RLS. The call provider itself
 * (place / hangup) still comes from createAmdRuntime().backend; only the DB
 * access moved off the Supabase client to Drizzle.
 *
 * The lifecycle itself (ringing → answered → AMD → hangup) is driven by inbound
 * events via the webhook route / mock backend, not here.
 */
import { revalidatePath } from 'next/cache';
import { and, count, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { getCurrentOrgId } from '@/lib/auth/org';
import { requireSession } from '@/lib/auth/session';
import { withServiceRls } from '@/lib/db/rls-service';
import { callAttempts, callRuns, contacts } from '@/lib/db/schema';
import { getOrgSettings, getUserSettings } from '@/lib/db/queries';
import { createAmdRuntime } from '@/lib/dialler/amd/runtime';
import { pickDialNumber } from '@/lib/dialler/normalise';
import type { AmdScenario, CallAttemptState } from '@/lib/dialler/amd/types';

const uuid = z.string().uuid();

/** Non-terminal attempt states — used to enforce one live attempt per run. */
const NON_TERMINAL: CallAttemptState[] = [
  'queued',
  'dialing',
  'ringing',
  'answered',
  'machine',
  'bridged',
];

/** Start a new AMD run owned by the caller. Returns the run id. */
export async function startAmdRun(): Promise<{ id: string }> {
  const orgId = await getCurrentOrgId();
  // Identity comes from the Auth.js session (replaces supabase.auth.getUser());
  // requireSession throws if unauthenticated, so `created_by` is always a real
  // user id.
  const session = await requireSession();

  const id = await withServiceRls(orgId, async (tx) => {
    const [row] = await tx
      .insert(callRuns)
      // org_id satisfies the INSERT WITH CHECK that pins the run to the org.
      .values({ orgId, mode: 'amd', status: 'active', createdBy: session.userId })
      .returning({ id: callRuns.id });
    if (!row) throw new Error('startAmdRun: failed to create run: no row');
    return row.id;
  });

  revalidatePath('/dialler');
  return { id };
}

const placeAmdCallSchema = z.object({
  runId: uuid,
  contactId: uuid,
  scenario: z.enum(['human', 'machine', 'no-answer', 'fail']).optional(),
});

export type PlaceAmdCallInput = z.input<typeof placeAmdCallSchema>;

/**
 * Queue + dial one contact within a run. Resolves the dial number (mobile-first)
 * with the org default country code, enforces one live attempt per run, then
 * places the AMD call through the backend (mock or Telnyx). On a backend failure
 * the attempt is marked `failed` rather than left dangling.
 */
export async function placeAmdCall(input: PlaceAmdCallInput): Promise<{ attemptId: string }> {
  const { runId, contactId, scenario } = placeAmdCallSchema.parse(input);
  const orgId = await getCurrentOrgId();

  // Number normalisation uses the org-wide default calling code; the outbound
  // caller ID is per-user (each rep dials from their own number / credential
  // connection), so it comes from the caller's own settings, not the org's.
  const [orgSettings, userSettings] = await Promise.all([getOrgSettings(), getUserSettings()]);
  const defaultCc = orgSettings.defaultCountryCode ?? '+44';
  const fromNumber = typeof userSettings.txCallerId === 'string' ? userSettings.txCallerId : '';

  // The backend is the call provider (place/hangup); only DB access moved to
  // Drizzle. Resolving it before the DB work also surfaces a misconfigured real
  // backend (missing Telnyx env) early, exactly as before.
  const { backend } = createAmdRuntime();

  // Set-up reads + the queue insert all run in one service transaction so the
  // org_id GUC is set once and the sequential-invariant count + insert see a
  // consistent snapshot. The resolved dial number is returned alongside the new
  // attempt id so the backend.placeCall below uses the SAME value the row was
  // created with — no second contact read.
  const { attemptId, toNumber } = await withServiceRls(orgId, async (tx) => {
    const [contactRow] = await tx
      .select({ phone: contacts.phone, mobile: contacts.mobile })
      .from(contacts)
      .where(and(eq(contacts.id, contactId), eq(contacts.orgId, orgId)));
    // A missing/cross-org contact yields no row; the original surfaced any
    // load failure as a throw — keep contact-not-found explicit.
    if (!contactRow) {
      throw new Error(`placeAmdCall: failed to load contact ${contactId}: not found`);
    }

    const dialNumber = pickDialNumber(contactRow, defaultCc);
    if (dialNumber === null) {
      throw new Error(`placeAmdCall: contact ${contactId} has no dialable number`);
    }

    // Authorize the run: it must belong to the caller's org. The service path
    // is org-scoped, but the explicit org_id predicate is the cross-org IDOR
    // guard so a guessed run UUID can't attach attempts to another org's run.
    const [runRow] = await tx
      .select({ id: callRuns.id })
      .from(callRuns)
      .where(and(eq(callRuns.id, runId), eq(callRuns.orgId, orgId)));
    if (!runRow) throw new Error('placeAmdCall: run not found for this org');

    // The real backend needs a caller ID; an empty `from` would fail opaquely at
    // the Telnyx API. The mock ignores `from`, so mock runs still proceed.
    if (backend.name !== 'mock' && !fromNumber) {
      throw new Error('placeAmdCall: no outbound caller ID configured (set your outbound CLI in Settings)');
    }

    // Sequential invariant: refuse a second live attempt in the same run.
    const [{ value: liveCount } = { value: 0 }] = await tx
      .select({ value: count() })
      .from(callAttempts)
      .where(
        and(
          eq(callAttempts.orgId, orgId),
          eq(callAttempts.runId, runId),
          inArray(callAttempts.state, NON_TERMINAL),
        ),
      );
    if (liveCount > 0) {
      throw new Error('placeAmdCall: a call is already in progress for this run');
    }

    let inserted;
    try {
      // Insert as 'queued': the first provider webhook (call.initiated) then
      // transitions it to 'dialing' and is captured in the event log. started_at
      // is stamped by applyEvent on that call.initiated.
      [inserted] = await tx
        .insert(callAttempts)
        .values({
          orgId,
          runId,
          contactId,
          toNumber: dialNumber,
          fromNumber: fromNumber || null,
          provider: backend.name,
          state: 'queued',
        })
        .returning({ id: callAttempts.id });
    } catch (cause) {
      // 23505 = unique violation on call_attempts_one_live_per_run_uidx: a
      // concurrent placeAmdCall already created a live attempt for this run (the
      // DB backstop for the count check above, which can race). Surface the same
      // friendly message rather than a raw constraint error.
      if ((cause as { code?: string }).code === '23505') {
        throw new Error('placeAmdCall: a call is already in progress for this run');
      }
      const message = cause instanceof Error ? cause.message : 'insert failed';
      throw new Error(`placeAmdCall: failed to create attempt: ${message}`);
    }
    if (!inserted) {
      throw new Error('placeAmdCall: failed to create attempt: no row');
    }
    return { attemptId: inserted.id, toNumber: dialNumber };
  });

  try {
    const { callControlId } = await backend.placeCall({
      to: toNumber,
      from: fromNumber,
      attemptId,
      runId,
      contactId,
      ...(scenario ? { scenario: scenario as AmdScenario } : {}),
    });
    // Persist the correlation id, but only while the attempt is still live and
    // detect the 0-rows case: if a concurrent cancel/hangup already terminated
    // it, or the write fails, we can no longer correlate this call — so we
    // best-effort hang it up rather than leak a live Telnyx call, and never
    // overwrite a terminal/cancelled attempt.
    let correlated: { id: string }[];
    try {
      correlated = await withServiceRls(orgId, (tx) =>
        tx
          .update(callAttempts)
          .set({ callControlId })
          .where(
            and(
              eq(callAttempts.id, attemptId),
              eq(callAttempts.orgId, orgId),
              inArray(callAttempts.state, NON_TERMINAL),
            ),
          )
          .returning({ id: callAttempts.id }),
      );
    } catch (ccCause) {
      const ccMessage = ccCause instanceof Error ? ccCause.message : 'update failed';
      // Scope to non-terminal so a concurrent cancel/end isn't overwritten
      // (cancelled → failed would corrupt the finalised disposition).
      await withServiceRls(orgId, (tx) =>
        tx
          .update(callAttempts)
          .set({ state: 'failed', error: ccMessage })
          .where(
            and(
              eq(callAttempts.id, attemptId),
              eq(callAttempts.orgId, orgId),
              inArray(callAttempts.state, NON_TERMINAL),
            ),
          ),
      );
      await backend.hangup(callControlId).catch(() => undefined);
      throw new Error(`placeAmdCall: failed to persist call_control_id: ${ccMessage}`);
    }
    if (correlated.length === 0) {
      await backend.hangup(callControlId).catch(() => undefined);
      throw new Error('placeAmdCall: attempt no longer active; hung up the placed call');
    }
  } catch (cause) {
    // Preserve the real reason (AmdBackendError, or the explicit call_control_id
    // persistence error) in call_attempts.error for ops triage; only fall back
    // to a generic string for a non-Error throw.
    const message = cause instanceof Error ? cause.message : 'dial failed';
    // Only mark failed while still non-terminal — never clobber a concurrently
    // finalised attempt (cancelled / webhook-driven ended).
    await withServiceRls(orgId, (tx) =>
      tx
        .update(callAttempts)
        .set({ state: 'failed', error: message })
        .where(
          and(
            eq(callAttempts.id, attemptId),
            eq(callAttempts.orgId, orgId),
            inArray(callAttempts.state, NON_TERMINAL),
          ),
        ),
    );
    throw cause;
  }

  revalidatePath('/dialler');
  return { attemptId };
}

/** Hang up a live attempt (asks the backend to terminate the call). Org-scoped. */
export async function hangupAttempt(attemptId: string): Promise<void> {
  const id = uuid.parse(attemptId);
  const orgId = await getCurrentOrgId();
  const { backend } = createAmdRuntime();

  // Scope by org_id: the service path is org-scoped, and the explicit predicate
  // is the cross-org IDOR guard so a guessed attempt UUID can't let one org hang
  // up another org's call.
  const callControlId = await withServiceRls(orgId, async (tx) => {
    const [row] = await tx
      .select({ callControlId: callAttempts.callControlId })
      .from(callAttempts)
      .where(and(eq(callAttempts.id, id), eq(callAttempts.orgId, orgId)));
    if (!row) throw new Error('hangupAttempt: attempt not found for this org');
    return row.callControlId;
  });
  if (callControlId) await backend.hangup(callControlId);

  revalidatePath('/dialler');
}

/**
 * Cancel an attempt that has not yet been correlated to a live Telnyx call
 * (`call_control_id` still null) — the "Skip" path before a call connects. A
 * correlated/live call must be ended via {@link hangupAttempt} instead, so this
 * never silently abandons an in-progress call. Org-scoped.
 */
export async function cancelAttempt(attemptId: string): Promise<void> {
  const id = uuid.parse(attemptId);
  const orgId = await getCurrentOrgId();
  const cancelled = await withServiceRls(orgId, (tx) =>
    tx
      .update(callAttempts)
      .set({ state: 'ended', disposition: 'cancelled', endedAt: new Date().toISOString() })
      .where(
        and(
          eq(callAttempts.id, id),
          eq(callAttempts.orgId, orgId),
          isNull(callAttempts.callControlId),
          inArray(callAttempts.state, ['queued', 'dialing']),
        ),
      )
      .returning({ id: callAttempts.id }),
  );
  // 0 rows = already correlated / progressed / terminal / wrong org. Throw so the
  // UI keeps the contact (and the rep can hang up instead) rather than advancing
  // past a still-live attempt.
  if (cancelled.length !== 1) {
    throw new Error('cancelAttempt: attempt not cancellable (already live or terminal)');
  }
  revalidatePath('/dialler');
}

const runStatusSchema = z.enum(['active', 'paused', 'done']);

/** Pause / resume / finish a run. Org-scoped. */
export async function setRunStatus(runId: string, status: z.infer<typeof runStatusSchema>): Promise<void> {
  const id = uuid.parse(runId);
  const nextStatus = runStatusSchema.parse(status);
  const orgId = await getCurrentOrgId();
  // Assert a row was affected (like cancelAttempt/hangupAttempt) so a stale or
  // cross-org runId surfaces as an explicit error rather than a silent no-op.
  const rows = await withServiceRls(orgId, (tx) =>
    tx
      .update(callRuns)
      .set({ status: nextStatus })
      .where(and(eq(callRuns.id, id), eq(callRuns.orgId, orgId)))
      .returning({ id: callRuns.id }),
  );
  if (rows.length === 0) {
    throw new Error('setRunStatus: run not found for this org');
  }
  revalidatePath('/dialler');
}
