import { describe, it, expect, beforeEach } from 'vitest';
import { runSender } from '@/lib/email/runner';
import { MockDriver } from '@/lib/email/mock';
import type { DueContact, EmailStore, RecordSentInput } from '@/lib/email/store';
import type { Contact, OrgSettings } from '@/lib/types/domain';

function contact(id: string, over: Partial<Contact> = {}): Contact {
  return {
    id,
    orgId: 'o1',
    campaignId: 'camp1',
    firstName: 'Mike',
    lastName: 'G',
    email: `${id}@example.com`,
    company: 'Acme',
    phone: null,
    mobile: null,
    jobTitle: 'IT',
    seniority: null,
    country: null,
    linkedin: null,
    status: 'none',
    sequenceDay: 0,
    followUp: '2026-05-25',
    lastEmailedAt: null,
    notes: null,
    legacyId: null,
    metadata: {},
    createdAt: '2026-05-31T00:00:00.000Z',
    updatedAt: '2026-05-31T00:00:00.000Z',
    ...over,
  };
}

// Two-step sequence at day offsets 0 and 3 (as the store would resolve them).
const STEP_OFFSETS = [0, 3];

function due(id: string, over: Partial<Contact> = {}): DueContact {
  const c = contact(id, over);
  const sequenceDay = c.sequenceDay ?? 0;
  const nextDayOffset = STEP_OFFSETS.find((d) => d > sequenceDay) ?? null;
  return {
    contact: c,
    campaignId: 'camp1',
    sequenceDay,
    nextDayOffset,
    template: { subject: 'Hi {firstName}', body: 'Body for {company}' },
  };
}

interface Rec {
  sent: RecordSentInput[];
  sentToday: number;
  dueList: DueContact[];
  /** Contact ids the claim should LOSE (simulating a concurrent run). */
  claimLost?: Set<string>;
  /** Contact ids whose claim was released (transport failure). */
  released?: string[];
}

function fakeStore(rec: Rec): EmailStore {
  return {
    async dueContacts() {
      // Ignores the limit param: returning the full list lets the runner's cap
      // guard + countDue-based remaining be exercised deterministically.
      return rec.dueList;
    },
    async countDue() {
      return rec.dueList.length;
    },
    async claimForSend(contactId) {
      return !rec.claimLost?.has(contactId);
    },
    async releaseClaim(contactId) {
      (rec.released ??= []).push(contactId);
    },
    async sentCountToday() {
      return rec.sentToday;
    },
    async recordSent(input) {
      rec.sent.push(input);
    },
    async findSentForCorrelation() {
      return null;
    },
    async inboundAlreadyRecorded() {
      return false;
    },
    async recordInbound() {},
    async loadScanCursor() {
      return null;
    },
    async advanceScanCursor() {},
  };
}

const settings: OrgSettings = { dailyGoal: 30, seqSkipWeekends: true, signature: 'Paul' };
const deps = (rec: Rec, driver: MockDriver) => ({
  store: fakeStore(rec),
  driver,
  settings,
  from: 'paul@displaynote.com',
  now: () => '2026-05-29T09:00:00.000Z',
});

describe('runSender', () => {
  let rec: Rec;
  let driver: MockDriver;
  beforeEach(() => {
    rec = { sent: [], sentToday: 0, dueList: [] };
    driver = new MockDriver();
  });

  it('sends to each due contact, renders the template, and records the send + advance', async () => {
    rec.dueList = [due('a'), due('b')];
    const res = await runSender(deps(rec, driver), { today: '2026-05-29' });

    expect(res.sent).toBe(2);
    expect(driver.sent).toHaveLength(2);
    expect(driver.sent[0]?.message.subject).toBe('Hi Mike');
    expect(driver.sent[0]?.message.to).toEqual(['a@example.com']);
    expect(rec.sent).toHaveLength(2);
    // Advance: from step day 0 → next step day 3 (delta 3 business days from today).
    expect(rec.sent[0]?.sequenceDay).toBe(0);
    expect(rec.sent[0]?.nextSequenceDay).toBe(3);
    expect(rec.sent[0]?.nextFollowUp).toBe('2026-06-01'); // Fri +3 = Mon (weekend rolled)
  });

  it('sets nextFollowUp null at the last step', async () => {
    rec.dueList = [due('a', { sequenceDay: 3 })]; // on the last step (day 3)
    await runSender(deps(rec, driver), { today: '2026-05-29' });
    expect(rec.sent[0]?.nextSequenceDay).toBeNull();
    expect(rec.sent[0]?.nextFollowUp).toBeNull();
  });

  it('respects the daily cap and reports the remainder', async () => {
    rec.dueList = [due('a'), due('b'), due('c')];
    rec.sentToday = 28; // cap 30 - 28 = 2 remaining
    const res = await runSender(deps(rec, driver), { today: '2026-05-29' });
    expect(res.sent).toBe(2);
    expect(res.remaining).toBe(1);
  });

  it('applies the daily-goal headroom before the per-run limit (no spurious zero cap)', async () => {
    rec.dueList = [due('a'), due('b'), due('c')];
    rec.sentToday = 28; // goal 30 → 2 left today; a limit of 5 must not zero this out
    const res = await runSender(deps(rec, driver), { today: '2026-05-29', limit: 5 });
    expect(res.sent).toBe(2);
    expect(res.remaining).toBe(1);
  });

  it('lets the per-run limit cap a run below the daily headroom', async () => {
    rec.dueList = [due('a'), due('b'), due('c')];
    rec.sentToday = 0; // 30 left today, but limit pins this run to 1
    const res = await runSender(deps(rec, driver), { today: '2026-05-29', limit: 1 });
    expect(res.sent).toBe(1);
    expect(res.remaining).toBe(2);
  });

  it('dry-run plans without sending or writing', async () => {
    rec.dueList = [due('a')];
    const res = await runSender(deps(rec, driver), { today: '2026-05-29', dryRun: true });
    expect(res.planned).toHaveLength(1);
    expect(res.sent).toBe(0);
    expect(driver.sent).toHaveLength(0);
    expect(rec.sent).toHaveLength(0);
  });

  it('skips (and surfaces) a step with no template instead of sending blank mail', async () => {
    rec.dueList = [{ ...due('a'), template: null }, due('b')];
    const res = await runSender(deps(rec, driver), { today: '2026-05-29' });
    expect(res.sent).toBe(1); // only 'b' sent
    expect(res.skipped).toBe(1);
    expect(driver.sent.map((s) => s.message.to[0])).toEqual(['b@example.com']);
    expect(res.errors.some((e) => /no template/.test(e.message))).toBe(true);
  });

  it('skips a contact whose claim was lost to a concurrent run (no double-send)', async () => {
    rec.dueList = [due('a'), due('b')];
    rec.claimLost = new Set(['a']); // another run already claimed 'a'
    const res = await runSender(deps(rec, driver), { today: '2026-05-29' });
    expect(res.sent).toBe(1); // only 'b'
    expect(driver.sent.map((s) => s.message.to[0])).toEqual(['b@example.com']);
  });

  it('isolates a send error: records it and continues the batch', async () => {
    rec.dueList = [due('a'), due('b')];
    const failing = new MockDriver();
    let n = 0;
    failing.send = async (_m) => {
      n += 1;
      if (n === 1) throw new Error('smtp down');
      return { messageId: `m${n}`, provider: 'mock', sentAt: '2026-05-29T09:00:00.000Z' };
    };
    const res = await runSender(deps(rec, failing), { today: '2026-05-29' });
    expect(res.errors).toHaveLength(1);
    expect(res.sent).toBe(1);
    expect(rec.sent).toHaveLength(1); // only the successful one advanced
    // The transport-failed contact's claim was released (so it retries today and
    // isn't counted toward the cap); the successful one's claim is NOT released.
    expect(rec.released).toEqual(['a']);
  });

  it('is a weekend no-op when seqSkipWeekends and today is Sat/Sun', async () => {
    rec.dueList = [due('a')];
    const res = await runSender(deps(rec, driver), { today: '2026-05-30' }); // Saturday
    expect(res.sent).toBe(0);
    expect(driver.sent).toHaveLength(0);
  });
});
