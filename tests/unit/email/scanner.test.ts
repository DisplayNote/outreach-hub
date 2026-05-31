import { describe, it, expect, beforeEach } from 'vitest';
import { scanInbox } from '@/lib/email/scanner';
import { MockDriver } from '@/lib/email/mock';
import type { EmailStore, RecordInboundInput, ScanCursor } from '@/lib/email/store';
import type { InboundMessage } from '@/lib/email/types';

interface Rec {
  inbound: RecordInboundInput[];
  recorded: Set<string>; // messageIds already recorded (dedup)
  correlatable: Set<string>; // sender emails that correlate to a contact
  cursor: ScanCursor | null; // persisted scan high-water + boundary ids
}

function fakeStore(rec: Rec): EmailStore {
  return {
    async dueContacts() {
      return [];
    },
    async countDue() {
      return 0;
    },
    async claimForSend() {
      return true;
    },
    async sentCountToday() {
      return 0;
    },
    async recordSent() {},
    async findSentForCorrelation(keys) {
      // The scanner resolves `from` to the right address (sender for a reply,
      // failed recipient for a bounce) before calling.
      const addr = keys.from.toLowerCase();
      return rec.correlatable.has(addr) ? { contactId: `contact-${addr}`, campaignId: 'camp1' } : null;
    },
    async inboundAlreadyRecorded(_provider, messageId) {
      return rec.recorded.has(messageId);
    },
    async recordInbound(input) {
      rec.inbound.push(input);
      rec.recorded.add(input.message.messageId);
    },
    async loadScanCursor() {
      return rec.cursor;
    },
    async advanceScanCursor(at, ids) {
      rec.cursor = { at, ids };
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
    rec = { inbound: [], recorded: new Set(), correlatable: new Set(['mike@example.com']), cursor: { at: '2026-05-20T00:00:00.000Z', ids: [] } };
    driver = new MockDriver();
  });

  it('records a correlated reply', async () => {
    driver.inbound.push(inbound({ messageId: 'r1', inReplyTo: 'sent-1' }));
    const res = await scanInbox(deps(rec, driver), {});
    expect(res.replies).toBe(1);
    expect(rec.inbound[0]?.kind).toBe('reply');
    expect(rec.inbound[0]?.contactId).toBe('contact-mike@example.com');
  });

  it('records a correlated bounce (NDR) via the recovered failed recipient', async () => {
    // NDR from the system mailer; the prospect is in failedRecipient.
    rec.correlatable.add('alice@corp.com');
    driver.inbound.push(
      inbound({ messageId: 'b1', from: 'postmaster@example.com', subject: 'Undeliverable', failedRecipient: 'alice@corp.com' }),
    );
    const res = await scanInbox(deps(rec, driver), {});
    expect(res.bounces).toBe(1);
    expect(rec.inbound[0]?.kind).toBe('bounce');
    expect(rec.inbound[0]?.contactId).toBe('contact-alice@corp.com');
  });

  it('ignores an NDR whose failed recipient could not be recovered', async () => {
    driver.inbound.push(inbound({ messageId: 'b2', from: 'postmaster@example.com', subject: 'Undeliverable' }));
    const res = await scanInbox(deps(rec, driver), {});
    expect(res.ignored).toBe(1);
    expect(rec.inbound).toHaveLength(0);
  });

  it('ignores an uncorrelated inbound', async () => {
    driver.inbound.push(inbound({ messageId: 'x1', from: 'stranger@nowhere.com' }));
    const res = await scanInbox(deps(rec, driver), {});
    expect(res.ignored).toBe(1);
    expect(rec.inbound).toHaveLength(0);
  });

  it('advances the cursor to the newest message (+ boundary ids) even when all are uncorrelated', async () => {
    driver.inbound.push(inbound({ messageId: 'x1', from: 'stranger@nowhere.com', receivedAt: '2026-05-29T11:00:00.000Z' }));
    await scanInbox(deps(rec, driver), {});
    // Lands ON the boundary (not past it) and records the id seen there, so a late
    // same-ms message (different id) isn't skipped while x1 isn't re-processed.
    expect(rec.cursor).toEqual({ at: '2026-05-29T11:00:00.000Z', ids: ['x1'] });
  });

  it('does not advance the cursor when the inbox is empty', async () => {
    await scanInbox(deps(rec, driver), {}); // empty inbox
    expect(rec.cursor).toEqual({ at: '2026-05-20T00:00:00.000Z', ids: [] });
  });

  it('skips a boundary message already seen, but processes a NEW same-ms message', async () => {
    rec.correlatable.add('amy@example.com');
    // Prior scan already saw `seen` at exactly the cursor timestamp.
    rec.cursor = { at: '2026-05-29T10:00:00.000Z', ids: ['seen'] };
    // Driver re-returns `seen` (>= since) plus a NEW message at the same ms.
    driver.inbound.push(inbound({ messageId: 'seen', from: 'mike@example.com', receivedAt: '2026-05-29T10:00:00.000Z' }));
    driver.inbound.push(inbound({ messageId: 'fresh', from: 'amy@example.com', receivedAt: '2026-05-29T10:00:00.000Z' }));
    const res = await scanInbox(deps(rec, driver), {});
    // `seen` was filtered out (not re-ignored/re-recorded); only `fresh` processed.
    expect(res.replies).toBe(1);
    expect(rec.inbound.map((i) => i.message.messageId)).toEqual(['fresh']);
    // New boundary set covers BOTH ids at that timestamp so neither re-processes.
    expect(rec.cursor.at).toBe('2026-05-29T10:00:00.000Z');
    expect([...rec.cursor.ids].sort()).toEqual(['fresh', 'seen']);
  });

  it('orders by parsed time, not raw ISO string (mixed precision)', async () => {
    rec.correlatable.add('amy@example.com');
    // As text, `…00.500Z` < `…00Z`, but it is 500ms LATER — must process the
    // whole-second message first.
    driver.inbound.push(inbound({ messageId: 'later', from: 'amy@example.com', receivedAt: '2026-05-29T10:00:00.500Z' }));
    driver.inbound.push(inbound({ messageId: 'earlier', from: 'mike@example.com', receivedAt: '2026-05-29T10:00:00Z' }));
    await scanInbox(deps(rec, driver), {});
    expect(rec.inbound.map((i) => i.message.messageId)).toEqual(['earlier', 'later']);
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
