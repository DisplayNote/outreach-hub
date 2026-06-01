import { describe, it, expect, vi } from 'vitest';
import { MailpitDriver } from '@/lib/email/mailpit';

function resp(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

function msg(id: string, created: string, over: Record<string, unknown> = {}) {
  return { ID: id, MessageID: `<${id}>`, From: { Address: `${id}@x.com` }, To: [{ Address: 'me@x.com' }], Subject: 'Re: hi', Created: created, ...over };
}

describe('MailpitDriver.fetchReplies', () => {
  it('pages through every page and filters by since', async () => {
    // 200 in page 1 (full → keep going), 1 in page 2 (short → stop).
    const page1 = { total: 201, messages: Array.from({ length: 200 }, (_, i) => msg(`a${i}`, '2026-05-29T10:00:00Z')) };
    const page2 = { total: 201, messages: [msg('b0', '2026-05-29T11:00:00Z')] };
    const fetchImpl = vi
      .fn(async (_u: string, _i?: RequestInit) => resp(page2))
      .mockImplementationOnce(async (_u: string, _i?: RequestInit) => resp(page1))
      .mockImplementationOnce(async (_u: string, _i?: RequestInit) => resp(page2));
    const driver = new MailpitDriver({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const replies = await driver.fetchReplies({ since: '2026-05-28T00:00:00.000Z' });
    expect(replies).toHaveLength(201); // both pages drained
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // Page 2 requested with the next start offset.
    expect(String(fetchImpl.mock.calls[1]![0])).toContain('start=200');
  });

  it('excludes messages older than since', async () => {
    const body = {
      total: 2,
      messages: [msg('new', '2026-05-29T10:00:00Z'), msg('old', '2026-05-01T10:00:00Z')],
    };
    const fetchImpl = vi.fn(async (_u: string, _i?: RequestInit) => resp(body));
    const driver = new MailpitDriver({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const replies = await driver.fetchReplies({ since: '2026-05-15T00:00:00.000Z' });
    expect(replies.map((r) => r.from)).toEqual(['new@x.com']);
  });

  it('throws EmailDriverError on a non-ok response', async () => {
    const fetchImpl = vi.fn(async (_u: string, _i?: RequestInit) => resp({}, false, 500));
    const driver = new MailpitDriver({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(driver.fetchReplies({ since: '2026-05-28T00:00:00.000Z' })).rejects.toThrow(/mailpit/i);
  });
});
