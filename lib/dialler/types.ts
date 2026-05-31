import type { ContactStatus } from '@/lib/types/domain';

/**
 * Lifecycle states a {@link Call} moves through. Mirrors the dialler outcome
 * model used by the UI. A call starts `idle`, progresses through
 * `dialling` → `ringing` → `connected`, then resolves to `ended`. Once a call
 * is over the UI sits in `awaiting-outcome` until the user records which
 * {@link CallOutcomeKey} happened.
 */
export type CallState =
  | 'idle'
  | 'dialling'
  | 'ringing'
  | 'connected'
  | 'ended'
  | 'awaiting-outcome';

/** All call states, in lifecycle order. */
export const CALL_STATES: readonly CallState[] = [
  'idle',
  'dialling',
  'ringing',
  'connected',
  'ended',
  'awaiting-outcome',
] as const;

/** Discrete outcomes a user can record after a call ends. */
export type CallOutcomeKey =
  | 'connected'
  | 'callback-requested'
  | 'meeting-booked'
  | 'left-voicemail'
  | 'no-answer'
  | 'gatekeeper'
  | 'not-interested'
  | 'wrong-number';

/**
 * UI-facing description of a call outcome. `statusEffect` is the
 * {@link ContactStatus} a recorded outcome should set on the contact;
 * `defaultNote` seeds the touchpoint note (channel `phone`) the user can edit.
 */
export interface CallOutcome {
  key: CallOutcomeKey;
  label: string;
  statusEffect: ContactStatus;
  defaultNote: string;
}

/**
 * A single dialler call. `state` is the current lifecycle position; `number` is
 * the normalised E.164 string actually dialled. `startedAt` / `endedAt` are ISO
 * timestamps (endedAt is null until the call reaches `ended`). `error` carries a
 * driver failure message, if any.
 */
export interface Call {
  /** Driver-assigned call id (unique within a session). */
  id: string;
  /** Driver that produced this call (e.g. 'mock', 'telnyx'). */
  provider: string;
  /** Normalised destination number, E.164 where possible. */
  number: string;
  state: CallState;
  startedAt: string;
  endedAt: string | null;
  error: string | null;
}

/** Callbacks a caller supplies to observe a call's progress. */
export interface CallHandlers {
  /** Fired on every state transition, with the updated {@link Call}. */
  onStateChange?: (call: Call) => void;
  /** Fired once when the call reaches a terminal state (`ended`). */
  onEnded?: (call: Call) => void;
  /** Fired if the driver fails to place or progress the call. */
  onError?: (error: Error, call: Call) => void;
}

/** Handle returned by {@link DiallerDriver.placeCall} to control a live call. */
export interface CallControl {
  /** Snapshot of the call as last observed. */
  readonly call: Call;
  /** Request the call be torn down. Idempotent; safe to call after `ended`. */
  hangup(): void;
}

/** A dialler backend: places calls and reports their lifecycle via handlers. */
export interface DiallerDriver {
  readonly name: string;

  /**
   * Begin dialling `number`, reporting progress through `handlers`. Returns a
   * {@link CallControl} immediately (the call is asynchronous); the initial
   * `call.state` is `dialling`.
   */
  placeCall(number: string, handlers?: CallHandlers): CallControl;
}

export class DiallerDriverError extends Error {
  public readonly code?: string;

  constructor(message: string, cause?: unknown, code?: string) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'DiallerDriverError';
    if (code !== undefined) this.code = code;
  }
}

export class NotImplementedError extends DiallerDriverError {
  constructor(message: string) {
    super(message, undefined, 'NOT_IMPLEMENTED');
    this.name = 'NotImplementedError';
  }
}
