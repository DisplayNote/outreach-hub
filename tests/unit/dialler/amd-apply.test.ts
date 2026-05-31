import { describe, it, expect, beforeEach } from 'vitest';
import { applyEvent, type AmdStore, type AttemptPatch } from '@/lib/dialler/amd/apply';
import type { CallAttempt } from '@/lib/dialler/amd/types';

interface Recorded {
  patches: { id: string; patch: AttemptPatch }[];
  events: { eventType: string; orgId: string; attemptId: string }[];
  touchpoints: { orgId: string; contactId: string; note: string; occurredAt: string }[];
}

function fakeStore(rec: Recorded): AmdStore {
  return {
    async updateAttempt(id, patch) {
      rec.patches.push({ id, patch });
    },
    async insertEvent(row) {
      rec.events.push({ eventType: row.eventType, orgId: row.orgId, attemptId: row.attemptId });
    },
    async insertTouchpoint(row) {
      rec.touchpoints.push(row);
    },
  };
}

function attempt(state: CallAttempt['state'], amdResult: CallAttempt['amdResult'] = null): CallAttempt {
  return {
    id: 'a1',
    orgId: 'o1',
    runId: 'r1',
    contactId: 'c1',
    toNumber: '+447700900002',
    fromNumber: null,
    provider: 'mock',
    callControlId: 'cc1',
    state,
    amdResult,
    disposition: null,
    hangupCause: null,
    error: null,
    startedAt: null,
    endedAt: null,
    createdAt: '2026-05-31T00:00:00.000Z',
    updatedAt: '2026-05-31T00:00:00.000Z',
  };
}

const NOW = '2026-05-31T12:00:00.000Z';

describe('applyEvent', () => {
  let rec: Recorded;
  beforeEach(() => {
    rec = { patches: [], events: [], touchpoints: [] };
  });

  it('persists the new state + always logs one event', async () => {
    await applyEvent(fakeStore(rec), attempt('dialing'), { eventType: 'call.ringing', callControlId: 'cc1' }, NOW);
    expect(rec.patches).toHaveLength(1);
    expect(rec.patches[0]?.patch.state).toBe('ringing');
    expect(rec.events).toHaveLength(1);
    expect(rec.events[0]?.eventType).toBe('call.ringing');
    expect(rec.touchpoints).toHaveLength(0);
  });

  it('machine detection logs exactly one auto-VM touchpoint and returns a hangup actuation', async () => {
    const out = await applyEvent(
      fakeStore(rec),
      attempt('answered'),
      { eventType: 'call.machine.detection.ended', callControlId: 'cc1', result: 'machine' },
      NOW,
    );
    expect(rec.patches[0]?.patch.state).toBe('machine');
    expect(rec.patches[0]?.patch.amdResult).toBe('machine');
    expect(rec.touchpoints).toEqual([
      { orgId: 'o1', contactId: 'c1', note: 'Voicemail reached — auto', occurredAt: NOW },
    ]);
    expect(out.actuations).toEqual(['hangup']);
  });

  it('human detection writes NO touchpoint and returns a bridge actuation', async () => {
    const out = await applyEvent(
      fakeStore(rec),
      attempt('answered'),
      { eventType: 'call.machine.detection.ended', callControlId: 'cc1', result: 'human' },
      NOW,
    );
    expect(rec.patches[0]?.patch.state).toBe('bridged');
    expect(rec.touchpoints).toHaveLength(0);
    expect(out.actuations).toEqual(['bridge']);
  });

  it('hangup after machine sets disposition + endedAt, no touchpoint', async () => {
    await applyEvent(
      fakeStore(rec),
      attempt('machine', 'machine'),
      { eventType: 'call.hangup', callControlId: 'cc1', hangupCause: 'normal_clearing' },
      NOW,
    );
    const patch = rec.patches[0]?.patch;
    expect(patch?.state).toBe('ended');
    expect(patch?.disposition).toBe('voicemail-auto');
    expect(patch?.endedAt).toBe(NOW);
    expect(patch?.hangupCause).toBe('normal_clearing');
    expect(rec.touchpoints).toHaveLength(0);
  });

  it('no-answer hangup logs no touchpoint and no actuation', async () => {
    const out = await applyEvent(
      fakeStore(rec),
      attempt('ringing'),
      { eventType: 'call.hangup', callControlId: 'cc1', hangupCause: 'timeout' },
      NOW,
    );
    expect(rec.patches[0]?.patch.disposition).toBe('no-answer');
    expect(rec.touchpoints).toHaveLength(0);
    expect(out.actuations).toEqual([]);
  });
});
