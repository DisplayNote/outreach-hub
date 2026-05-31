/**
 * Pure event→state reducer for the AMD call lifecycle (PHASE_4_SPEC §3/§4).
 *
 * Given the current attempt and an inbound {@link TelnyxEvent}, returns the next
 * state, any disposition / amdResult to persist, and the side-effects the caller
 * (applyEvent) must actuate. No I/O, no clock, no randomness — every branch is
 * deterministic and unit-tested, so the same logic backs both the real webhook
 * route and the mock backend.
 *
 * The authoritative behaviour mirrors the legacy Worker's webhook handler
 * (legacy/worker.js L196–271):
 *   - answered does NOT bridge — we wait for AMD (L210);
 *   - machine/fax ⇒ auto-hangup + a "Voicemail reached — auto" touchpoint (L225–230);
 *   - human/not_sure/human_residence ⇒ bridge to the rep (L231–238);
 *   - a hangup with no AMD result (never answered / answered-then-dropped) is a
 *     no-answer and logs nothing (handover §4.3 CRM-cleanliness rule).
 */
import {
  MACHINE_AMD_RESULTS,
  type CallAttempt,
  type CallAttemptState,
  type CallSideEffect,
  type ReduceResult,
  type TelnyxEvent,
} from '@/lib/dialler/amd/types';

/** Fresh "no disposition / no effects" tail (a new array each call, never shared). */
function noopTail(): Pick<ReduceResult, 'disposition' | 'amdResult' | 'sideEffects'> {
  return { disposition: null, amdResult: null, sideEffects: [] };
}

/**
 * Monotonic rank of the early "progress" states. Used to apply
 * initiated/ringing/answered transitions only when they move FORWARD, so an
 * out-of-order or retried earlier webhook (e.g. a late `call.initiated` after
 * `call.answered`) can't regress the state. States past this phase
 * (machine/bridged/ended/failed) are absent → any progress event is a no-op.
 */
const PROGRESS_RANK: Partial<Record<CallAttemptState, number>> = {
  queued: 0,
  dialing: 1,
  ringing: 2,
  answered: 3,
};

function advanceProgress(attempt: CallAttempt, target: CallAttemptState): ReduceResult {
  const current = PROGRESS_RANK[attempt.state];
  const next = PROGRESS_RANK[target];
  if (current === undefined || next === undefined || next <= current) {
    return { nextState: attempt.state, ...noopTail() }; // don't regress / already past
  }
  return { nextState: target, ...noopTail() };
}

export function reduceEvent(attempt: CallAttempt, event: TelnyxEvent): ReduceResult {
  // Idempotency (webhooks are at-least-once): once an attempt is terminal, ignore
  // any further/duplicate events. This keeps endedAt stable and prevents a
  // replayed hangup from re-running side-effects.
  if (attempt.state === 'ended' || attempt.state === 'failed') {
    return { nextState: attempt.state, ...noopTail() };
  }

  switch (event.eventType) {
    case 'call.initiated':
      return advanceProgress(attempt, 'dialing');

    case 'call.ringing':
      return advanceProgress(attempt, 'ringing');

    case 'call.answered':
      // Do NOT bridge yet — wait for the AMD result (worker.js L210).
      return advanceProgress(attempt, 'answered');

    case 'call.machine.detection.ended': {
      // AMD already decided for this attempt (duplicate event). Don't re-log the
      // touchpoint or re-transition — but if the actuation was never confirmed
      // (e.g. the first hangup/bridge threw and Telnyx retried), re-emit JUST the
      // actuation so it is eventually performed (at-least-once).
      if (attempt.amdResult !== null || attempt.state === 'machine' || attempt.state === 'bridged') {
        if (attempt.actuatedAt === null) {
          // Decide from state first: a `machine` attempt must re-emit hangup even
          // if amd_result didn't persist — never bridge (transfer) a machine.
          const isMachine =
            attempt.state === 'machine' ||
            (attempt.amdResult !== null && MACHINE_AMD_RESULTS.has(attempt.amdResult));
          const sideEffect: CallSideEffect = isMachine ? 'hangup' : 'bridge';
          return { nextState: attempt.state, disposition: null, amdResult: null, sideEffects: [sideEffect] };
        }
        return { nextState: attempt.state, ...noopTail() };
      }
      const result = event.result ?? null;
      if (result !== null && MACHINE_AMD_RESULTS.has(result)) {
        // Machine/fax: hang up and auto-log the voicemail touchpoint.
        return {
          nextState: 'machine',
          disposition: null,
          amdResult: result,
          sideEffects: ['hangup', 'log-vm-touchpoint'],
        };
      }
      // human / not_sure / human_residence (or a missing result): bridge to rep.
      return {
        nextState: 'bridged',
        disposition: null,
        amdResult: result,
        sideEffects: ['bridge'],
      };
    }

    case 'call.hangup': {
      // Disposition is decided by how far the call got (attempt.amdResult / state).
      let disposition: ReduceResult['disposition'];
      if (attempt.amdResult !== null && MACHINE_AMD_RESULTS.has(attempt.amdResult)) {
        disposition = 'voicemail-auto';
      } else if (attempt.state === 'bridged' || attempt.amdResult !== null) {
        disposition = 'bridged-human';
      } else {
        // Never answered, or answered then dropped before AMD: no touchpoint.
        disposition = 'no-answer';
      }
      return {
        nextState: 'ended',
        disposition,
        amdResult: null,
        sideEffects: [],
      };
    }

    default: {
      // Unknown/ignored event — no transition.
      return { nextState: attempt.state, ...noopTail() };
    }
  }
}
