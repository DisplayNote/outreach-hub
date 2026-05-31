import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockTelnyxBackend, resolveScenario } from '@/lib/dialler/amd/mock-backend';
import { processEvent, type ProcessDeps } from '@/lib/dialler/amd/process';
import type { AmdStore, AttemptPatch } from '@/lib/dialler/amd/apply';
import type { CallAttempt, TelnyxEvent } from '@/lib/dialler/amd/types';

/** In-memory attempt + write capture, keyed by call_control_id. */
function harness() {
  const attempts = new Map<string, CallAttempt>();
  const touchpoints: { contactId: string; note: string }[] = [];
  const events: string[] = [];

  const store: AmdStore = {
    async updateAttempt(id, patch: AttemptPatch) {
      const found = [...attempts.values()].find((a) => a.id === id);
      if (found) Object.assign(found, stripUndefined(patch));
    },
    async insertEvent(row) {
      events.push(row.eventType);
    },
    async insertTouchpoint(row) {
      touchpoints.push({ contactId: row.contactId, note: row.note });
    },
  };

  const backend = new MockTelnyxBackend({
    process: async (e: TelnyxEvent) => {
      await processEvent(deps, e);
    },
    timings: { step: 10 },
  });

  const deps: ProcessDeps = {
    store,
    loadAttempt: async (ccid) => attempts.get(ccid) ?? null,
    actuator: backend,
    now: () => '2026-05-31T12:00:00.000Z',
    bridgeTarget: 'sip:rep@sip.telnyx.com',
  };

  return { attempts, touchpoints, events, backend };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function seedQueued(attempts: Map<string, CallAttempt>, id: string, to: string): CallAttempt {
  const a: CallAttempt = {
    id,
    orgId: 'o1',
    runId: 'r1',
    contactId: `contact-${id}`,
    toNumber: to,
    fromNumber: '+441234567890',
    provider: 'mock',
    callControlId: null,
    state: 'queued',
    amdResult: null,
    disposition: null,
    hangupCause: null,
    error: null,
    startedAt: null,
    endedAt: null,
    createdAt: '2026-05-31T00:00:00.000Z',
    updatedAt: '2026-05-31T00:00:00.000Z',
  };
  return a;
}

describe('resolveScenario', () => {
  it('honours an explicit scenario over the number suffix', () => {
    expect(resolveScenario('+447700900002', 'human')).toBe('human');
  });
  it('maps the number suffix (…0001 human, …0002 machine, …0003 no-answer, …0009 fail)', () => {
    expect(resolveScenario('+447700900001')).toBe('human');
    expect(resolveScenario('+447700900002')).toBe('machine');
    expect(resolveScenario('+447700900003')).toBe('no-answer');
    expect(resolveScenario('+447700900009')).toBe('fail');
  });
  it('defaults to human for an unmapped number', () => {
    expect(resolveScenario('+447700905555')).toBe('human');
  });
});

describe('MockTelnyxBackend drives the lifecycle through applyEvent', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function run(to: string, scenario?: 'human' | 'machine' | 'no-answer' | 'fail') {
    const h = harness();
    const attempt = seedQueued(h.attempts, 'a1', to);
    const placeArgs = { to, from: '+441234567890', attemptId: 'a1', runId: 'r1', contactId: 'contact-a1' };
    const { callControlId } = await h.backend.placeCall(scenario ? { ...placeArgs, scenario } : placeArgs);
    attempt.callControlId = callControlId;
    h.attempts.set(callControlId, attempt);
    await vi.runAllTimersAsync();
    return { ...h, attempt };
  }

  it('machine → ended/voicemail-auto with exactly one auto-VM touchpoint', async () => {
    const { attempt, touchpoints } = await run('+447700900002');
    expect(attempt.state).toBe('ended');
    expect(attempt.disposition).toBe('voicemail-auto');
    expect(touchpoints).toEqual([{ contactId: 'contact-a1', note: 'Voicemail reached — auto' }]);
  });

  it('human → ended/bridged-human with no touchpoint', async () => {
    const { attempt, touchpoints } = await run('+447700900001');
    expect(attempt.state).toBe('ended');
    expect(attempt.disposition).toBe('bridged-human');
    expect(touchpoints).toHaveLength(0);
  });

  it('no-answer → ended/no-answer with no touchpoint', async () => {
    const { attempt, touchpoints } = await run('+447700900003');
    expect(attempt.state).toBe('ended');
    expect(attempt.disposition).toBe('no-answer');
    expect(touchpoints).toHaveLength(0);
  });

  it('fail scenario rejects placeCall (caller marks the attempt failed)', async () => {
    const h = harness();
    seedQueued(h.attempts, 'a1', '+447700900009');
    await expect(
      h.backend.placeCall({ to: '+447700900009', from: '+441', attemptId: 'a1', runId: 'r1', contactId: 'contact-a1', scenario: 'fail' }),
    ).rejects.toThrow();
  });
});
