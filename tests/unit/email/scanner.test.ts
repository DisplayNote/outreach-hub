import { describe, it, expect, beforeEach } from 'vitest';
import { scanInbox } from '@/lib/email/scanner';
import { MockDriver } from '@/lib/email/mock';
import type { EmailStore, RecordInboundInput } from '@/lib/email/store';
import type { InboundMessage } from '@/lib/email/types';

interface Rec {
  inbound: RecordInboundInput[];
  recorded: Set<string>; // messageIds already recorded (dedup)
  correlatable: Set<string>; // sender emails that correlate to a contact
}

function fakeStore(rec: Rec): EmailStore {
  return {
    async dueContacts() {
      return [];
    },
    async sentCountToday() {
      return 0;
    },
    async recordSent() {},
    async findSentForCorrelation(keys) {
      const from = keys.from.toLowerCase();
      return rec.correlatable.has(from) ? { contactId: `contact-${from}`, campaignId: 'camp1' } : null;
    },
    async inboundAlreadyRecorded(_provider, messageId) {
      return rec.recorded.has(messageId);
    },
    async recordInbound(input) {
      rec.inbound.push(input);
      rec.recorded.add(input.message.messageId);
    },
    async lastScanHighWater() {
      return '2026-05-20T00:00:00.000Z';
    },
  };
}

function inbound(over: Partial<InboundMessage>): InboundMessage {
  return {
    messageId: 'm1',
    from: 'mike@example.com',
    to: ['paul@displaynote.com'],
    subject: 'Re: hello',
    receivedAt: '2026-05-29T10:00:00.000Z',
    ...over,
  };
}

const deps = (rec: Rec, driver: MockDriver) => ({ store: fakeStore(rec), driver, orgId: 'o1' });

describe('scanInbox', () => {
  let rec: Rec;
  let driver: MockDriver;
  beforeEach(() => {
    rec = { inbound: [], recorded: new Set(), correlatable: new Set(['mike@example.com']) };
    driver = new MockDriver();
  });

  it('records a correlated reply', async () => {
    driver.inbound.push(inbound({ messageId: 'r1', inReplyTo: 'sent-1' }));
    const res = await scanInbox(deps(rec, driver), {});
    expect(res.replies).toBe(1);
    expect(rec.inbound[0]?.kind).toBe('reply');
    expect(rec.inbound[0]?.contactId).toBe('contact-mike@example.com');
  });

  it('records a correlated bounce (NDR)', async () => {
    rec.correlatable.add('postmaster@example.com');
    driver.inbound.push(inbound({ messageId: 'b1', from: 'postmaster@example.com', subject: 'Undeliverable' }));
    const res = await scanInbox(deps(rec, driver), {});
    expect(res.bounces).toBe(1);
    expect(rec.inbound[0]?.kind).toBe('bounce');
  });

  it('ignores an uncorrelated inbound', async () => {
    driver.inbound.push(inbound({ messageId: 'x1', from: 'stranger@nowhere.com' }));
    const res = await scanInbox(deps(rec, driver), {});
    expect(res.ignored).toBe(1);
    expect(rec.inbound).toHaveLength(0);
  });

  it('processes oldest-first even when the driver returns newest-first', async () => {
    rec.correlatable.add('amy@example.com');
    // Driver hands them back newest-first (as Mailpit does).
    driver.inbound.push(inbound({ messageId: 'new', from: 'amy@example.com', receivedAt: '2026-05-29T12:00:00.000Z' }));
    driver.inbound.push(inbound({ messageId: 'old', from: 'mike@example.com', receivedAt: '2026-05-29T08:00:00.000Z' }));
    await scanInbox(deps(rec, driver), {});
    // Recorded ascending by receivedAt, so a mid-scan failure can't advance the
    // high-water past an unprocessed older message.
    expect(rec.inbound.map((i) => i.message.messageId)).toEqual(['old', 'new']);
  });

  it('dedupes an already-recorded inbound', async () => {
    rec.recorded.add('r1');
    driver.inbound.push(inbound({ messageId: 'r1', inReplyTo: 'sent-1' }));
    const res = await scanInbox(deps(rec, driver), {});
    expect(res.replies).toBe(0);
    expect(rec.inbound).toHaveLength(0);
  });
});
