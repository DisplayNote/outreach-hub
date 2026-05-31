/**
 * Persists the effect of one inbound call event: runs the pure {@link reduceEvent},
 * writes the new attempt state + an append-only event row, and (only on a machine
 * detection) the one server-side auto-voicemail touchpoint (PHASE_4_SPEC §3/§4).
 *
 * Writes go through an injected {@link AmdStore} so the orchestration is unit-
 * testable with a fake; the real adapter ({@link supabaseAmdStore}) runs against
 * the service-role Supabase client (the only writer of call state — DECISION 4.1).
 * `now` is passed in (no `Date.now()` here) to keep the logic deterministic.
 *
 * Returns the reduce result plus the `hangup` / `bridge` actuations the caller
 * must perform on the dialler backend (applyEvent never calls Telnyx itself).
 */
import { reduceEvent } from '@/lib/dialler/amd/reducer';
import type {
  AmdResult,
  CallAttempt,
  CallAttemptState,
  CallDisposition,
  ReduceResult,
  TelnyxEvent,
} from '@/lib/dialler/amd/types';

/** The auto-logged note when AMD hangs up on a machine (handover §4.3). */
export const AUTO_VOICEMAIL_NOTE = 'Voicemail reached — auto';

/** Columns of `call_attempts` that an event transition may set. */
export interface AttemptPatch {
  state?: CallAttemptState;
  amdResult?: AmdResult | null;
  disposition?: CallDisposition | null;
  hangupCause?: string | null;
  callControlId?: string;
  startedAt?: string;
  endedAt?: string;
}

/** The narrow write surface applyEvent needs (real adapter or a test fake). */
export interface AmdStore {
  updateAttempt(id: string, patch: AttemptPatch): Promise<void>;
  insertEvent(row: {
    orgId: string;
    attemptId: string;
    eventType: string;
    payload: Record<string, unknown>;
    occurredAt: string;
  }): Promise<void>;
  insertTouchpoint(row: {
    orgId: string;
    contactId: string;
    note: string;
    occurredAt: string;
    /** Deterministic dedup key (unique per org) so retries don't double-log. */
    legacyId: string;
  }): Promise<void>;
  /** Mark an attempt's hangup/bridge actuation confirmed (at-least-once support). */
  markActuated(attemptId: string, occurredAt: string): Promise<void>;
}

/** Trim the event to the fields worth auditing (DECISION 11.2 — no raw dump). */
function trimPayload(event: TelnyxEvent): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (event.result !== undefined) payload.result = event.result;
  if (event.hangupCause !== undefined) payload.hangupCause = event.hangupCause;
  if (event.customHeaders !== undefined) payload.customHeaders = event.customHeaders;
  return payload;
}

export interface ApplyEventResult {
  result: ReduceResult;
  /** Backend calls the caller must actuate, in order. */
  actuations: ('hangup' | 'bridge')[];
}

export async function applyEvent(
  store: AmdStore,
  attempt: CallAttempt,
  event: TelnyxEvent,
  now: string,
): Promise<ApplyEventResult> {
  const result = reduceEvent(attempt, event);

  // Stamp call_control_id from the first inbound event when it isn't persisted
  // yet (the event was correlated via the customHeaders attemptId fallback), so
  // later events match by call_control_id and manual hangups have an id to use.
  // Gated to a non-terminal attempt with an unset id, so a late fallback event on
  // an already cancelled/ended attempt stays a full no-op (no UPDATE / event row).
  const needsCallControlId =
    attempt.state !== 'ended' &&
    attempt.state !== 'failed' &&
    attempt.callControlId === null &&
    event.callControlId !== '';

  // No-op (duplicate / ignored event once terminal): write nothing — no attempt
  // UPDATE (avoids Realtime churn and overwriting endedAt) and no event row.
  const isNoop =
    result.nextState === attempt.state &&
    result.disposition === null &&
    result.amdResult === null &&
    result.sideEffects.length === 0 &&
    !needsCallControlId;
  if (isNoop) {
    return { result, actuations: [] };
  }

  // Insert the auto-VM touchpoint BEFORE persisting the machine state, with a
  // deterministic dedup key. If this insert fails, the state isn't yet `machine`,
  // so the retry re-runs the fresh transition and re-emits the touchpoint; once
  // it succeeds, the dedup key makes any later re-run a no-op. This closes the
  // window where a transient touchpoint failure would be lost (the reducer
  // suppresses log-vm-touchpoint once the attempt is already in `machine`).
  if (result.sideEffects.includes('log-vm-touchpoint')) {
    await store.insertTouchpoint({
      orgId: attempt.orgId,
      contactId: attempt.contactId,
      note: AUTO_VOICEMAIL_NOTE,
      occurredAt: now,
      legacyId: `amd-vm-${attempt.id}`,
    });
  }

  // Persist only fields that actually change; set endedAt once, on the
  // transition INTO `ended` (not on a later duplicate).
  const patch: AttemptPatch = {};
  if (needsCallControlId) patch.callControlId = event.callControlId;
  if (result.nextState !== attempt.state) patch.state = result.nextState;
  if (result.amdResult !== null && result.amdResult !== attempt.amdResult) patch.amdResult = result.amdResult;
  if (result.disposition !== null && result.disposition !== attempt.disposition) patch.disposition = result.disposition;
  if (event.hangupCause !== undefined && event.hangupCause !== attempt.hangupCause) patch.hangupCause = event.hangupCause;
  if (event.eventType === 'call.initiated' && attempt.startedAt === null) patch.startedAt = now;
  if (result.nextState === 'ended' && attempt.state !== 'ended') patch.endedAt = now;

  if (Object.keys(patch).length > 0) {
    await store.updateAttempt(attempt.id, patch);
  }

  await store.insertEvent({
    orgId: attempt.orgId,
    attemptId: attempt.id,
    eventType: event.eventType,
    payload: trimPayload(event),
    occurredAt: now,
  });

  const actuations = result.sideEffects.filter(
    (e): e is 'hangup' | 'bridge' => e === 'hangup' || e === 'bridge',
  );
  return { result, actuations };
}
