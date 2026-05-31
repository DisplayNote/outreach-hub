'use server';

/**
 * Phase 4 Server Actions for the AMD dialler ("Mode B").
 *
 * These are the app-initiated control-plane entry points: start a run, place an
 * AMD call, hang up / cancel an attempt, pause-stop a run. All call-table writes
 * go through the service role (createAmdRuntime → client), with org membership
 * resolved from the caller's session (getCurrentOrgId) and every row scoped to
 * that org — so the browser never mutates call state directly (DECISION 4.1).
 *
 * The lifecycle itself (ringing → answered → AMD → hangup) is driven by inbound
 * events via the webhook route / mock backend, not here.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCurrentOrgId } from '@/lib/supabase/org';
import { createClient } from '@/lib/supabase/server';
import { getOrgSettings } from '@/lib/supabase/queries';
import { createAmdRuntime } from '@/lib/dialler/amd/runtime';
import { pickDialNumber } from '@/lib/dialler/normalise';
import { AmdBackendError, type AmdScenario, type CallAttemptState } from '@/lib/dialler/amd/types';

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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('startAmdRun: not authenticated');

  const { client } = createAmdRuntime();
  const { data, error } = await client
    .from('call_runs')
    .insert({ org_id: orgId, mode: 'amd', status: 'active', created_by: user.id })
    .select('id')
    .single();
  if (error) throw new Error(`startAmdRun: ${error.message}`);

  revalidatePath('/dialler');
  return { id: (data as { id: string }).id };
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
  const supabase = await createClient();

  const settings = await getOrgSettings();
  const defaultCc = settings.defaultCountryCode ?? '+44';
  const fromNumber = typeof settings.txCallerId === 'string' ? settings.txCallerId : '';

  const { data: contactRow, error: contactErr } = await supabase
    .from('contacts')
    .select('id, phone, mobile')
    .eq('id', contactId)
    .single();
  if (contactErr) throw new Error(`placeAmdCall: failed to load contact ${contactId}: ${contactErr.message}`);

  const toNumber = pickDialNumber(contactRow as { phone: string | null; mobile: string | null }, defaultCc);
  if (toNumber === null) {
    throw new Error(`placeAmdCall: contact ${contactId} has no dialable number`);
  }

  const { backend, client } = createAmdRuntime();

  // Authorize the run: it must belong to the caller's org. The service-role
  // client bypasses RLS, so without this an attacker could attach attempts to
  // another org's run by guessing its UUID (cross-org IDOR).
  const { data: runRow, error: runErr } = await client
    .from('call_runs')
    .select('id')
    .eq('id', runId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (runErr) throw new Error(`placeAmdCall: ${runErr.message}`);
  if (!runRow) throw new Error('placeAmdCall: run not found for this org');

  // The real backend needs a caller ID; an empty `from` would fail opaquely at
  // the Telnyx API. The mock ignores `from`, so mock runs still proceed.
  if (backend.name !== 'mock' && !fromNumber) {
    throw new Error('placeAmdCall: no outbound caller ID configured (set txCallerId in org settings)');
  }

  // Sequential invariant: refuse a second live attempt in the same run.
  const { count, error: countErr } = await client
    .from('call_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('run_id', runId)
    .in('state', NON_TERMINAL);
  if (countErr) throw new Error(`placeAmdCall: ${countErr.message}`);
  if ((count ?? 0) > 0) {
    throw new Error('placeAmdCall: a call is already in progress for this run');
  }

  const { data: attempt, error: insErr } = await client
    .from('call_attempts')
    .insert({
      org_id: orgId,
      run_id: runId,
      contact_id: contactId,
      to_number: toNumber,
      from_number: fromNumber || null,
      provider: backend.name,
      // Insert as 'queued': the first provider webhook (call.initiated) then
      // transitions it to 'dialing' and is captured in the event log. started_at
      // is stamped by applyEvent on that call.initiated.
      state: 'queued',
    })
    .select('id')
    .single();
  if (insErr) {
    // 23505 = unique violation on call_attempts_one_live_per_run_uidx: a
    // concurrent placeAmdCall already created a live attempt for this run (the
    // DB backstop for the count check above, which can race). Surface the same
    // friendly message rather than a raw constraint error.
    if ((insErr as { code?: string }).code === '23505') {
      throw new Error('placeAmdCall: a call is already in progress for this run');
    }
    throw new Error(`placeAmdCall: failed to create attempt: ${insErr.message}`);
  }
  const attemptId = (attempt as { id: string }).id;

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
    const { data: correlated, error: ccErr } = await client
      .from('call_attempts')
      .update({ call_control_id: callControlId })
      .eq('id', attemptId)
      .eq('org_id', orgId)
      .in('state', NON_TERMINAL)
      .select('id');
    if (ccErr) {
      // Scope to non-terminal so a concurrent cancel/end isn't overwritten
      // (cancelled → failed would corrupt the finalised disposition).
      await client
        .from('call_attempts')
        .update({ state: 'failed', error: ccErr.message })
        .eq('id', attemptId)
        .eq('org_id', orgId)
        .in('state', NON_TERMINAL);
      await backend.hangup(callControlId).catch(() => undefined);
      throw new Error(`placeAmdCall: failed to persist call_control_id: ${ccErr.message}`);
    }
    if (!correlated || correlated.length === 0) {
      await backend.hangup(callControlId).catch(() => undefined);
      throw new Error('placeAmdCall: attempt no longer active; hung up the placed call');
    }
  } catch (cause) {
    const message = cause instanceof AmdBackendError ? cause.message : 'dial failed';
    // Only mark failed while still non-terminal — never clobber a concurrently
    // finalised attempt (cancelled / webhook-driven ended).
    await client
      .from('call_attempts')
      .update({ state: 'failed', error: message })
      .eq('id', attemptId)
      .eq('org_id', orgId)
      .in('state', NON_TERMINAL);
    throw cause;
  }

  revalidatePath('/dialler');
  return { attemptId };
}

/** Hang up a live attempt (asks the backend to terminate the call). Org-scoped. */
export async function hangupAttempt(attemptId: string): Promise<void> {
  const id = uuid.parse(attemptId);
  const orgId = await getCurrentOrgId();
  const { backend, client } = createAmdRuntime();

  // Scope by org_id: the service-role client bypasses RLS, so a guessed attempt
  // UUID must not let one org hang up another org's call.
  const { data, error } = await client
    .from('call_attempts')
    .select('call_control_id')
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw new Error(`hangupAttempt: ${error.message}`);
  if (!data) throw new Error('hangupAttempt: attempt not found for this org');
  const callControlId = (data as { call_control_id: string | null }).call_control_id;
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
  const { client } = createAmdRuntime();
  const { data, error } = await client
    .from('call_attempts')
    .update({ state: 'ended', disposition: 'cancelled', ended_at: new Date().toISOString() })
    .eq('id', id)
    .eq('org_id', orgId)
    .is('call_control_id', null)
    .in('state', ['queued', 'dialing'])
    .select('id');
  if (error) throw new Error(`cancelAttempt: ${error.message}`);
  // 0 rows = already correlated / progressed / terminal / wrong org. Throw so the
  // UI keeps the contact (and the rep can hang up instead) rather than advancing
  // past a still-live attempt.
  if (!data || data.length !== 1) {
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
  const { client } = createAmdRuntime();
  const { error } = await client
    .from('call_runs')
    .update({ status: nextStatus })
    .eq('id', id)
    .eq('org_id', orgId);
  if (error) throw new Error(`setRunStatus: ${error.message}`);
  revalidatePath('/dialler');
}
