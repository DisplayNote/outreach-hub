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
  'amd_pending',
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

  // Sequential invariant: refuse a second live attempt in the same run.
  const { count, error: countErr } = await client
    .from('call_attempts')
    .select('id', { count: 'exact', head: true })
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
      state: 'dialing',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (insErr) throw new Error(`placeAmdCall: failed to create attempt: ${insErr.message}`);
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
    await client.from('call_attempts').update({ call_control_id: callControlId }).eq('id', attemptId);
  } catch (cause) {
    const message = cause instanceof AmdBackendError ? cause.message : 'dial failed';
    await client.from('call_attempts').update({ state: 'failed', error: message }).eq('id', attemptId);
    throw cause;
  }

  revalidatePath('/dialler');
  return { attemptId };
}

/** Hang up a live attempt (asks the backend to terminate the call). */
export async function hangupAttempt(attemptId: string): Promise<void> {
  const id = uuid.parse(attemptId);
  await getCurrentOrgId(); // authorize (throws if unauthenticated / no org)
  const { backend, client } = createAmdRuntime();

  const { data, error } = await client
    .from('call_attempts')
    .select('call_control_id')
    .eq('id', id)
    .single();
  if (error) throw new Error(`hangupAttempt: ${error.message}`);
  const callControlId = (data as { call_control_id: string | null }).call_control_id;
  if (callControlId) await backend.hangup(callControlId);

  revalidatePath('/dialler');
}

/** Cancel a not-yet-dialled attempt (no Telnyx call placed). */
export async function cancelAttempt(attemptId: string): Promise<void> {
  const id = uuid.parse(attemptId);
  await getCurrentOrgId();
  const { client } = createAmdRuntime();
  const { error } = await client
    .from('call_attempts')
    .update({ state: 'ended', disposition: 'cancelled', ended_at: new Date().toISOString() })
    .eq('id', id)
    .eq('state', 'queued');
  if (error) throw new Error(`cancelAttempt: ${error.message}`);
  revalidatePath('/dialler');
}

const runStatusSchema = z.enum(['active', 'paused', 'done']);

/** Pause / resume / finish a run. */
export async function setRunStatus(runId: string, status: z.infer<typeof runStatusSchema>): Promise<void> {
  const id = uuid.parse(runId);
  const nextStatus = runStatusSchema.parse(status);
  await getCurrentOrgId();
  const { client } = createAmdRuntime();
  const { error } = await client.from('call_runs').update({ status: nextStatus }).eq('id', id);
  if (error) throw new Error(`setRunStatus: ${error.message}`);
  revalidatePath('/dialler');
}
