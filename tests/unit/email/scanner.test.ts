import { describe, it, expect, beforeEach } from 'vitest';
import { scanInbox } from '@/lib/email/scanner';
import { MockDriver } from '@/lib/email/mock';
import type { EmailStore, RecordInboundInput, ScanCursor } from '@/lib/email/store';
import type { InboundMessage } from '@/lib/email/types';

interface Rec {
  inbound: RecordInboundInput[];
  recorded: Set<string>; // messageIds already recorded (dedup)
  correlatable: Set<string>; // sender emails that correlate to a contact
  correlatableRefs?: Set<string>; // message-ids (in_reply_to / references) that correlate
  cursors: Record<string, ScanCursor>; // persisted scan high-water + boundary ids, per mailbox
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
    async releaseClaim() {},
    async sentCountToday() {
      return 0;
    },
    async recordSent() {},
    async findSentForCorrelation(keys) {
      // Thread correlation (in_reply_to / references) takes precedence, like the
      // adapter; else the scanner-resolved `from` (sender / failed recipient).
      const refHit = [keys.inReplyTo, ...keys.references].some((r) => r && rec.correlatableRefs?.has(r));
      if (refHit) return { contactId: 'contact-by-ref', campaignId: 'camp1' };
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
    async loadScanCursor(mailbox) {
      return rec.cursors[mailbox] ?? null;
    },
    async advanceScanCursor(mailbox, at, ids) {
      rec.cursors[mailbox] = { at, ids };
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

const deps = (rec: Rec, driver: MockDriver, mailbox = 'paul@displaynote.com') => ({
  store: fakeStore(rec),
  driver,
  orgId: 'o1',
  mailbox,
});

describe('scanInbox', () => {
  let rec: Rec;
  let driver: MockDriver;
  beforeEach(() => {
    rec = {
      inbound: [],
      recorded: new Set(),
      correlatable: new Set(['mike@example.com']),
      cursors: { 'paul@displaynote.com': { at: '2026-05-20T00:00:00.000Z', ids: [] } },
    };
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
    expect(rec.cursors['paul@displaynote.com']).toEqual({ at: '2026-05-29T11:00:00.000Z', ids: ['x1'] });
  });

  it('does not advance the cursor when the inbox is empty', async () => {
    await scanInbox(deps(rec, driver), {}); // empty inbox
    expect(rec.cursors['paul@displaynote.com']).toEqual({ at: '2026-05-20T00:00:00.000Z', ids: [] });
  });

  it('skips a boundary message already seen, but processes a NEW same-ms message', async () => {
    rec.correlatable.add('amy@example.com');
    // Prior scan already saw `seen` at exactly the cursor timestamp.
    rec.cursors['paul@displaynote.com'] = { at: '2026-05-29T10:00:00.000Z', ids: ['seen'] };
    // Driver re-returns `seen` (>= since) plus a NEW message at the same ms.
    driver.inbound.push(inbound({ messageId: 'seen', from: 'mike@example.com', receivedAt: '2026-05-29T10:00:00.000Z' }));
    driver.inbound.push(inbound({ messageId: 'fresh', from: 'amy@example.com', receivedAt: '2026-05-29T10:00:00.000Z' }));
    const res = await scanInbox(deps(rec, driver), {});
    // `seen` was filtered out (not re-ignored/re-recorded); only `fresh` processed.
    expect(res.replies).toBe(1);
    expect(rec.inbound.map((i) => i.message.messageId)).toEqual(['fresh']);
    // New boundary set covers BOTH ids at that timestamp so neither re-processes.
    const c = rec.cursors['paul@displaynote.com']!;
    expect(c.at).toBe('2026-05-29T10:00:00.000Z');
    expect([...c.ids].sort()).toEqual(['fresh', 'seen']);
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

  it('correlates a reply via References when In-Reply-To is absent', async () => {
    rec.correlatableRefs = new Set(['<sent-42@x>']);
    // A reply with a References chain but no inReplyTo and an unknown sender.
    driver.inbound.push(
      inbound({ messageId: 'r9', from: 'someone-else@elsewhere.com', references: ['<root@x>', '<sent-42@x>'] }),
    );
    const res = await scanInbox(deps(rec, driver), {});
    expect(res.replies).toBe(1);
    expect(rec.inbound[0]?.contactId).toBe('contact-by-ref');
  });

  it('dedupes an already-recorded inbound', async () => {
    rec.recorded.add('r1');
    driver.inbound.push(inbound({ messageId: 'r1', inReplyTo: 'sent-1' }));
    const res = await scanInbox(deps(rec, driver), {});
    expect(res.replies).toBe(0);
    expect(rec.inbound).toHaveLength(0);
  });

  it('keeps cursors isolated per mailbox: one mailbox cannot advance another past its messages', async () => {
    // Mailbox A scans and lands its cursor far in the future...
    rec.cursors = {
      'a@org.com': { at: '2026-05-20T00:00:00.000Z', ids: [] },
      'b@org.com': { at: '2026-05-20T00:00:00.000Z', ids: [] },
    };
    driver.inbound.push(inbound({ messageId: 'a1', from: 'mike@example.com', receivedAt: '2026-05-29T12:00:00.000Z' }));
    await scanInbox(deps(rec, driver, 'a@org.com'), {});
    // A advanced only its own cursor; B's is untouched.
    expect(rec.cursors['a@org.com']).toEqual({ at: '2026-05-29T12:00:00.000Z', ids: ['a1'] });
    expect(rec.cursors['b@org.com']).toEqual({ at: '2026-05-20T00:00:00.000Z', ids: [] });

    // Now a message arrives for B at a time BEFORE A's advanced cursor. Because B
    // reads ITS OWN (older) cursor, B still sees and records it — the pre-fix bug
    // (shared org cursor) would have skipped it permanently.
    const driverB = new MockDriver();
    driverB.inbound.push(inbound({ messageId: 'b1', from: 'mike@example.com', receivedAt: '2026-05-29T11:00:00.000Z' }));
    const resB = await scanInbox(deps(rec, driverB, 'b@org.com'), {});
    expect(resB.replies).toBe(1);
    expect(rec.cursors['b@org.com']).toEqual({ at: '2026-05-29T11:00:00.000Z', ids: ['b1'] });
  });
});
