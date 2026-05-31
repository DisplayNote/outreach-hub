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
  type ReduceResult,
  type TelnyxEvent,
} from '@/lib/dialler/amd/types';

const NOOP_TAIL = { disposition: null, amdResult: null, sideEffects: [] } as const;

export function reduceEvent(attempt: CallAttempt, event: TelnyxEvent): ReduceResult {
  switch (event.eventType) {
    case 'call.initiated':
      return { nextState: 'dialing', ...NOOP_TAIL };

    case 'call.ringing':
      return { nextState: 'ringing', ...NOOP_TAIL };

    case 'call.answered':
      // Do NOT bridge yet — wait for the AMD result (worker.js L210).
      return { nextState: 'answered', ...NOOP_TAIL };

    case 'call.machine.detection.ended': {
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
      return { nextState: attempt.state, ...NOOP_TAIL };
    }
  }
}
