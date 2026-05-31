/**
 * In-process mock Telnyx backend (PHASE_4_SPEC §7) — the dev/test default that
 * makes Mode B runnable with no Telnyx account. On `placeCall` it schedules the
 * same webhook event sequence real Telnyx would send, on short timers, feeding
 * them through the SAME `processEvent` the real webhook route uses — so the mock
 * exercises the actual reducer + persistence, not a parallel fake.
 *
 * Scenario is deterministic (no RNG, per the repo rule): an explicit `scenario`
 * wins, else it is derived from the dialled number suffix (DECISION 7.1).
 * Actuation-driven events (the hangup after a machine, the hangup ending a
 * bridged human call) arrive via `hangup`/`bridge`, exactly like the real path.
 */
import { AmdBackendError, type AmdScenario, type TelnyxEvent, type TelnyxEventType } from '@/lib/dialler/amd/types';
import type { AmdDiallerBackend, PlaceCallOptions } from '@/lib/dialler/amd/backend';

export interface MockTimings {
  /** Milliseconds between successive simulated events. */
  step: number;
}

const DEFAULT_TIMINGS: MockTimings = { step: 400 };

/** Map a dialled number (or explicit override) to a deterministic scenario. */
export function resolveScenario(to: string, explicit?: AmdScenario): AmdScenario {
  if (explicit) return explicit;
  const digits = to.replace(/\D/g, '');
  const suffix = digits.slice(-4);
  switch (suffix) {
    case '0001':
      return 'human';
    case '0002':
      return 'machine';
    case '0003':
      return 'no-answer';
    case '0009':
      return 'fail';
    default:
      return 'human';
  }
}

/** The "inbound" event types each scenario emits before any actuation. */
function scriptFor(scenario: AmdScenario): { type: TelnyxEventType; result?: 'human' | 'machine' }[] {
  switch (scenario) {
    case 'machine':
      return [
        { type: 'call.initiated' },
        { type: 'call.ringing' },
        { type: 'call.answered' },
        { type: 'call.machine.detection.ended', result: 'machine' },
      ];
    case 'human':
      return [
        { type: 'call.initiated' },
        { type: 'call.ringing' },
        { type: 'call.answered' },
        { type: 'call.machine.detection.ended', result: 'human' },
      ];
    case 'no-answer':
      return [{ type: 'call.initiated' }, { type: 'call.ringing' }, { type: 'call.hangup' }];
    case 'fail':
      return [];
  }
}

export class MockTelnyxBackend implements AmdDiallerBackend {
  readonly name = 'mock';

  private readonly process: (event: TelnyxEvent) => Promise<void>;
  private readonly timings: MockTimings;

  constructor(deps: { process: (event: TelnyxEvent) => Promise<void>; timings?: Partial<MockTimings> }) {
    this.process = deps.process;
    this.timings = { ...DEFAULT_TIMINGS, ...deps.timings };
  }

  async placeCall(opts: PlaceCallOptions): Promise<{ callControlId: string }> {
    const scenario = resolveScenario(opts.to, opts.scenario);
    if (scenario === 'fail') {
      throw new AmdBackendError(`mock dial failed for ${opts.to}`, undefined, 'MOCK_DIAL_FAILED');
    }

    const callControlId = `mock-cc-${opts.attemptId}`;
    const customHeaders = { attemptId: opts.attemptId, runId: opts.runId, contactId: opts.contactId };
    const script = scriptFor(scenario);

    script.forEach((step, i) => {
      const event: TelnyxEvent = {
        eventType: step.type,
        callControlId,
        customHeaders,
        ...(step.result !== undefined ? { result: step.result } : {}),
        ...(step.type === 'call.hangup' ? { hangupCause: 'timeout' } : {}),
      };
      this.schedule(() => this.process(event), this.timings.step * (i + 1));
    });

    return { callControlId };
  }

  async hangup(callControlId: string): Promise<void> {
    // Real Telnyx would emit call.hangup after we ask it to hang up; the mock
    // emits it directly so the attempt reaches `ended`.
    await this.process({ eventType: 'call.hangup', callControlId, hangupCause: 'normal_clearing' });
  }

  async bridge(callControlId: string, _target: string): Promise<void> {
    // Simulate the bridged human call ending a moment later.
    this.schedule(
      () => this.process({ eventType: 'call.hangup', callControlId, hangupCause: 'normal_clearing' }),
      this.timings.step,
    );
  }

  private schedule(fn: () => Promise<void>, ms: number): void {
    setTimeout(() => {
      // Swallow+log: an unhandled rejection inside a setTimeout would crash the
      // dev server / flake tests. processEvent failures surface in the logs.
      void fn().catch((err: unknown) => {
        console.error('MockTelnyxBackend scheduled event failed', err);
      });
    }, ms);
  }
}
