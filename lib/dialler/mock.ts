import type { DiallerDriver } from '@/lib/dialler/driver';
import type { Call, CallControl, CallHandlers, CallState } from '@/lib/dialler/types';

let counter = 0;

/**
 * Tuneable timings (ms) for the simulated lifecycle. Defaults are short so the
 * UI feels responsive; tests can pass `{ dialling: 0, ringing: 0, connected: 0 }`
 * to drive the whole lifecycle synchronously-ish via fake timers.
 */
export interface MockTimings {
  /** Delay before `dialling` → `ringing`. */
  dialling: number;
  /** Delay before `ringing` → `connected`. */
  ringing: number;
  /** Delay the call stays `connected` before auto-`ended`. */
  connected: number;
}

const DEFAULT_TIMINGS: MockTimings = {
  dialling: 600,
  ringing: 1500,
  connected: 4000,
};

/**
 * Client-side dialler that simulates the call lifecycle with timers — no real
 * telephony. The transition sequence is deterministic
 * (`dialling` → `ringing` → `connected` → `ended`); only the wall-clock pacing
 * is timer-driven, so tests using fake timers can advance through it
 * predictably. `hangup()` short-circuits to `ended` from any live state.
 *
 * Pure TS with no Node/Next imports, so it is safe to instantiate inside a
 * `'use client'` component.
 */
export class MockDiallerDriver implements DiallerDriver {
  readonly name = 'mock';

  private readonly timings: MockTimings;

  constructor(timings?: Partial<MockTimings>) {
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
  }

  placeCall(number: string, handlers?: CallHandlers): CallControl {
    counter += 1;

    const call: Call = {
      id: `mock-call-${counter}-${Date.now()}`,
      provider: this.name,
      number,
      state: 'dialling',
      startedAt: new Date().toISOString(),
      endedAt: null,
      error: null,
    };

    const timers: ReturnType<typeof setTimeout>[] = [];
    let finished = false;

    const emit = (next: CallState): void => {
      if (finished) return;
      call.state = next;
      if (next === 'ended') {
        call.endedAt = new Date().toISOString();
      }
      handlers?.onStateChange?.(call);
      if (next === 'ended') {
        finished = true;
        handlers?.onEnded?.(call);
      }
    };

    const schedule = (fn: () => void, ms: number): void => {
      timers.push(setTimeout(fn, ms));
    };

    // Announce the initial `dialling` state asynchronously so callers can wire
    // up handlers off the returned control before the first transition fires.
    schedule(() => handlers?.onStateChange?.(call), 0);

    schedule(() => {
      emit('ringing');
      schedule(() => {
        emit('connected');
        schedule(() => emit('ended'), this.timings.connected);
      }, this.timings.ringing);
    }, this.timings.dialling);

    const clearAll = (): void => {
      for (const t of timers) clearTimeout(t);
      timers.length = 0;
    };

    return {
      get call(): Call {
        return call;
      },
      hangup: (): void => {
        if (finished) return;
        clearAll();
        emit('ended');
      },
    };
  }
}
