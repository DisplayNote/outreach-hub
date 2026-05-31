import { describe, it, expect } from 'vitest';
import { reduceEvent } from '@/lib/dialler/amd/reducer';
import type { CallAttempt, TelnyxEvent } from '@/lib/dialler/amd/types';

/** Minimal attempt stub in a given state (other fields irrelevant to the reducer). */
function attempt(
  state: CallAttempt['state'],
  amdResult: CallAttempt['amdResult'] = null,
  actuatedAt: string | null = null,
): CallAttempt {
  return {
    id: 'a1',
    orgId: 'o1',
    runId: 'r1',
    contactId: 'c1',
    toNumber: '+447700900001',
    fromNumber: null,
    provider: 'mock',
    callControlId: 'cc1',
    state,
    amdResult,
    disposition: null,
    hangupCause: null,
    error: null,
    actuatedAt,
    startedAt: null,
    endedAt: null,
    createdAt: '2026-05-31T00:00:00.000Z',
    updatedAt: '2026-05-31T00:00:00.000Z',
  };
}

function ev(eventType: TelnyxEvent['eventType'], extra: Partial<TelnyxEvent> = {}): TelnyxEvent {
  return { eventType, callControlId: 'cc1', ...extra };
}

describe('reduceEvent — progress transitions', () => {
  it('call.initiated → dialing', () => {
    expect(reduceEvent(attempt('queued'), ev('call.initiated')).nextState).toBe('dialing');
  });

  it('call.ringing → ringing', () => {
    expect(reduceEvent(attempt('dialing'), ev('call.ringing')).nextState).toBe('ringing');
  });

  it('call.answered → answered with NO side-effects (await AMD, worker.js L210)', () => {
    const r = reduceEvent(attempt('ringing'), ev('call.answered'));
    expect(r.nextState).toBe('answered');
    expect(r.sideEffects).toEqual([]);
  });
});

describe('reduceEvent — AMD detection', () => {
  it.each(['machine', 'fax'] as const)('result %s → machine, hangup + log VM touchpoint', (result) => {
    const r = reduceEvent(attempt('answered'), ev('call.machine.detection.ended', { result }));
    expect(r.nextState).toBe('machine');
    expect(r.amdResult).toBe(result);
    expect(r.sideEffects).toEqual(['hangup', 'log-vm-touchpoint']);
    expect(r.disposition).toBeNull(); // disposition finalised on hangup
  });

  it.each(['human', 'not_sure', 'human_residence'] as const)(
    'result %s → bridged, bridge side-effect, NO touchpoint',
    (result) => {
      const r = reduceEvent(attempt('answered'), ev('call.machine.detection.ended', { result }));
      expect(r.nextState).toBe('bridged');
      expect(r.amdResult).toBe(result);
      expect(r.sideEffects).toEqual(['bridge']);
    },
  );
});

describe('reduceEvent — hangup disposition (PHASE_4_SPEC §4)', () => {
  it('hangup after machine → ended / voicemail-auto, no touchpoint side-effect', () => {
    const r = reduceEvent(attempt('machine', 'machine'), ev('call.hangup', { hangupCause: 'normal_clearing' }));
    expect(r.nextState).toBe('ended');
    expect(r.disposition).toBe('voicemail-auto');
    expect(r.sideEffects).toEqual([]);
  });

  it('hangup after bridge → ended / bridged-human', () => {
    const r = reduceEvent(attempt('bridged', 'human'), ev('call.hangup'));
    expect(r.nextState).toBe('ended');
    expect(r.disposition).toBe('bridged-human');
  });

  it('hangup from ringing (never answered) → ended / no-answer, NO touchpoint', () => {
    const r = reduceEvent(attempt('ringing'), ev('call.hangup', { hangupCause: 'timeout' }));
    expect(r.nextState).toBe('ended');
    expect(r.disposition).toBe('no-answer');
    expect(r.sideEffects).toEqual([]);
  });

  it('hangup from answered but no AMD result → ended / no-answer', () => {
    const r = reduceEvent(attempt('answered'), ev('call.hangup'));
    expect(r.nextState).toBe('ended');
    expect(r.disposition).toBe('no-answer');
  });
});

describe('reduceEvent — idempotency (at-least-once webhooks)', () => {
  it('ignores any event once the attempt is ended', () => {
    const r = reduceEvent(attempt('ended', 'machine'), ev('call.hangup', { hangupCause: 'dup' }));
    expect(r.nextState).toBe('ended');
    expect(r.sideEffects).toEqual([]);
    expect(r.disposition).toBeNull(); // does not re-finalise / overwrite
  });

  it('a duplicate machine detection re-emits ONLY the hangup when not yet actuated (no 2nd touchpoint)', () => {
    const r = reduceEvent(attempt('machine', 'machine', null), ev('call.machine.detection.ended', { result: 'machine' }));
    expect(r.sideEffects).toEqual(['hangup']);
    expect(r.nextState).toBe('machine');
    expect(r.disposition).toBeNull();
  });

  it('a duplicate machine detection is a full no-op once actuated', () => {
    const r = reduceEvent(
      attempt('machine', 'machine', '2026-05-31T12:00:00.000Z'),
      ev('call.machine.detection.ended', { result: 'machine' }),
    );
    expect(r.sideEffects).toEqual([]);
  });

  it('a duplicate detection re-emits ONLY the bridge for an unactuated human', () => {
    const r = reduceEvent(attempt('bridged', 'human', null), ev('call.machine.detection.ended', { result: 'human' }));
    expect(r.sideEffects).toEqual(['bridge']);
    expect(r.nextState).toBe('bridged');
  });
});
