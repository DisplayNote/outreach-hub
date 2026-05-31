/**
 * Types for the Phase 4 server-orchestrated AMD dialler ("Mode B").
 *
 * The browser never drives the call lifecycle — it observes `call_attempts`
 * rows over Supabase Realtime. These shapes mirror the snake_case Postgres
 * tables in supabase/migrations/20260531120000_phase4_dialler_amd.sql as
 * camelCase TS, following the same convention as lib/types/domain.ts.
 */

/**
 * public.call_attempt_state enum — verbatim, lower-case members, in lifecycle
 * order. See PHASE_4_SPEC §3.
 */
export type CallAttemptState =
  | 'queued'
  | 'dialing'
  | 'ringing'
  | 'answered'
  | 'machine'
  | 'bridged'
  | 'ended'
  | 'failed';

/** All states in lifecycle order. */
export const CALL_ATTEMPT_STATES: readonly CallAttemptState[] = [
  'queued',
  'dialing',
  'ringing',
  'answered',
  'machine',
  'bridged',
  'ended',
  'failed',
] as const;

/**
 * The result Telnyx Premium AMD reports on `call.machine.detection.ended`
 * (worker.js L215). `machine`/`fax` ⇒ auto-hangup + voicemail touchpoint;
 * the rest are treated as a human and bridged (PHASE_4_SPEC §3/§4).
 */
export type AmdResult = 'human' | 'machine' | 'not_sure' | 'fax' | 'human_residence';

/** AMD results that mean "a machine answered" (auto-hangup branch). */
export const MACHINE_AMD_RESULTS: ReadonlySet<AmdResult> = new Set<AmdResult>(['machine', 'fax']);

/**
 * Terminal classification written to `call_attempts.disposition` once a call
 * ends (PHASE_4_SPEC §2.2).
 */
export type CallDisposition =
  | 'voicemail-auto'
  | 'bridged-human'
  | 'no-answer'
  | 'failed'
  | 'cancelled';

/**
 * Which deterministic outcome the mock backend should simulate for an attempt
 * (PHASE_4_SPEC §7, DECISION 7.1). Either passed explicitly (tests) or derived
 * from the dialled number suffix.
 */
export type AmdScenario = 'human' | 'machine' | 'no-answer' | 'fail';

/**
 * The Telnyx Call-Control webhook event types we act on (worker.js L196–271).
 * Other events (call.cost, call.dtmf.received, …) are ignored.
 */
export type TelnyxEventType =
  | 'call.initiated'
  | 'call.ringing'
  | 'call.answered'
  | 'call.machine.detection.ended'
  | 'call.hangup';

/**
 * A normalised inbound call event — the shape the reducer consumes, mapped from
 * either a real Telnyx webhook payload or a mock-generated event. `result` is
 * present only on `call.machine.detection.ended`; `hangupCause` only on
 * `call.hangup`. `customHeaders` carries the correlation ids when the row could
 * not be found by `callControlId` (worker.js L182–191).
 */
export interface TelnyxEvent {
  eventType: TelnyxEventType;
  callControlId: string;
  result?: AmdResult;
  hangupCause?: string;
  customHeaders?: { attemptId?: string; runId?: string; contactId?: string };
  /** Raw (trimmed) provider payload, persisted to call_events.payload. */
  payload?: Record<string, unknown>;
}

/**
 * Side-effects the reducer asks the caller (applyEvent) to actuate after a
 * transition. `hangup`/`bridge` are backend calls; `log-vm-touchpoint` is the
 * one server-side auto-touchpoint write (PHASE_4_SPEC §4).
 */
export type CallSideEffect = 'hangup' | 'bridge' | 'log-vm-touchpoint';

/**
 * Pure result of {@link reduceEvent}: the next state plus any disposition /
 * amdResult to persist and the side-effects to actuate. `null` fields mean
 * "leave unchanged".
 */
export interface ReduceResult {
  nextState: CallAttemptState;
  disposition: CallDisposition | null;
  amdResult: AmdResult | null;
  sideEffects: CallSideEffect[];
}

// --- Domain rows (camelCase) -------------------------------------------------

/** public.call_runs row. */
export interface CallRun {
  id: string;
  orgId: string;
  mode: string;
  status: 'active' | 'paused' | 'done';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** public.call_attempts row — the live state the UI renders. */
export interface CallAttempt {
  id: string;
  orgId: string;
  runId: string;
  contactId: string;
  toNumber: string;
  fromNumber: string | null;
  provider: string;
  callControlId: string | null;
  state: CallAttemptState;
  amdResult: AmdResult | null;
  disposition: CallDisposition | null;
  hangupCause: string | null;
  error: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** public.call_events row — append-only per-attempt log. */
export interface CallEvent {
  id: string;
  orgId: string;
  attemptId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  createdAt: string;
}

/** Error raised by an {@link AmdDiallerBackend}; forwards `cause` (ADR 003). */
export class AmdBackendError extends Error {
  public readonly code?: string;

  constructor(message: string, cause?: unknown, code?: string) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AmdBackendError';
    if (code !== undefined) this.code = code;
  }
}
