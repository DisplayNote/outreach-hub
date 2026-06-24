import { describe, it, expect, vi } from 'vitest';
import { GraphDriver } from '@/lib/email/graph';

function resp(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

/** A raw-text response (e.g. a `/$value` MIME body). */
function rawResp(text: string, ok = true, status = 200): Response {
  return { ok, status, json: async () => ({}), text: async () => text } as Response;
}

describe('GraphDriver.send', () => {
  it('POSTs /me/sendMail with the message + bearer token', async () => {
    const fetchImpl = vi.fn(async (_u: string, _i?: RequestInit) => resp({}, true, 202));
    const driver = new GraphDriver('graph-dev', { accessToken: 'TOK', fetchImpl: fetchImpl as unknown as typeof fetch });

    const ref = await driver.send({ from: 'me@x.com', to: ['a@x.com'], subject: 'Hi', bodyHtml: '<p>yo</p>' });
    expect(ref.provider).toBe('graph-dev');
    expect(ref.messageId).toBeTruthy();

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://graph.microsoft.com/v1.0/me/sendMail');
    expect((init as RequestInit).method).toBe('POST');
    expect(((init as RequestInit).headers as Record<string, string>).Authorization).toBe('Bearer TOK');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.saveToSentItems).toBe(true);
    expect(body.message.subject).toBe('Hi');
    expect(body.message.toRecipients[0].emailAddress.address).toBe('a@x.com');
  });

  it('throws EmailDriverError on a non-ok response', async () => {
    const fetchImpl = vi.fn(async (_u: string, _i?: RequestInit) => resp({ error: { message: 'bad' } }, false, 400));
    const driver = new GraphDriver('graph-dev', { accessToken: 'TOK', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(driver.send({ from: 'm', to: ['a'], subject: 's' })).rejects.toThrow(/graph/i);
  });

  it('throws when no access token is configured', async () => {
    const driver = new GraphDriver('graph-dev');
    await expect(driver.send({ from: 'm', to: ['a'], subject: 's' })).rejects.toThrow(/token/i);
  });
});

describe('GraphDriver.fetchReplies', () => {
  it('GETs the inbox filtered by since and maps to InboundMessage', async () => {
    const graphBody = {
      value: [
        {
          internetMessageId: '<abc@x>',
          conversationId: 'conv1',
          subject: 'Re: Hi',
          from: { emailAddress: { address: 'mike@example.com' } },
          toRecipients: [{ emailAddress: { address: 'me@x.com' } }],
          receivedDateTime: '2026-05-29T10:00:00Z',
          bodyPreview: 'thanks',
        },
      ],
    };
    const fetchImpl = vi.fn(async (_u: string, _i?: RequestInit) => resp(graphBody));
    const driver = new GraphDriver('graph-dev', { accessToken: 'TOK', fetchImpl: fetchImpl as unknown as typeof fetch });

    const replies = await driver.fetchReplies({ since: '2026-05-28T00:00:00.000Z' });
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ messageId: '<abc@x>', from: 'mike@example.com', conversationId: 'conv1' });
    const url = String(fetchImpl.mock.calls[0]![0]);
    expect(url).toContain('/me/mailFolders/Inbox/messages');
    expect(url).toContain('receivedDateTime');
  });

  it('follows @odata.nextLink to drain every page', async () => {
    const page1 = {
      '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/Inbox/messages?$skip=50',
      value: [{ id: 'm1', from: { emailAddress: { address: 'a@example.com' } }, receivedDateTime: '2026-05-29T10:00:00Z' }],
    };
    const page2 = {
      value: [{ id: 'm2', from: { emailAddress: { address: 'b@example.com' } }, receivedDateTime: '2026-05-29T10:00:00Z' }],
    };
    const fetchImpl = vi
      .fn(async (_u: string, _i?: RequestInit) => resp(page1))
      .mockImplementationOnce(async (_u: string, _i?: RequestInit) => resp(page1))
      .mockImplementationOnce(async (_u: string, _i?: RequestInit) => resp(page2));
    const driver = new GraphDriver('graph-dev', { accessToken: 'TOK', fetchImpl: fetchImpl as unknown as typeof fetch });

    const replies = await driver.fetchReplies({ since: '2026-05-28T00:00:00.000Z' });
    expect(replies.map((r) => r.from)).toEqual(['a@example.com', 'b@example.com']);
    // Page 2 fetched via the absolute nextLink URL.
    expect(String(fetchImpl.mock.calls[1]![0])).toBe(page1['@odata.nextLink']);
  });

  it('falls back to the message id when internetMessageId is absent', async () => {
    const fetchImpl = vi.fn(async (_u: string, _i?: RequestInit) =>
      resp({ value: [{ id: 'graph-id-1', from: { emailAddress: { address: 'a@x.com' } } }] }),
    );
    const driver = new GraphDriver('graph-dev', { accessToken: 'TOK', fetchImpl: fetchImpl as unknown as typeof fetch });
    const replies = await driver.fetchReplies({ since: '2026-05-28T00:00:00.000Z' });
    expect(replies[0]!.messageId).toBe('graph-id-1');
  });

  it('recovers the failed recipient from an NDR preview into failedRecipient', async () => {
    const fetchImpl = vi.fn(async (_u: string, _i?: RequestInit) =>
      String(_u).includes('/$value') ? resp({}, false, 404) : resp({
        value: [
          {
            id: 'ndr1',
            from: { emailAddress: { address: 'postmaster@outlook.com' } },
            subject: 'Undeliverable: Quick question',
            bodyPreview: "Your message to alice@corp.com couldn't be delivered.",
          },
        ],
      }),
    );
    const driver = new GraphDriver('graph-prod', { accessToken: 'TOK', fetchImpl: fetchImpl as unknown as typeof fetch });
    const replies = await driver.fetchReplies({ since: '2026-05-28T00:00:00.000Z' });
    expect(replies[0]!.from).toBe('postmaster@outlook.com');
    expect(replies[0]!.failedRecipient).toBe('alice@corp.com');
  });

  it('prefers an RFC 3464 Final-Recipient line over a stray address', async () => {
    const fetchImpl = vi.fn(async (_u: string, _i?: RequestInit) =>
      String(_u).includes('/$value') ? resp({}, false, 404) : resp({
        value: [
          {
            id: 'ndr2',
            from: { emailAddress: { address: 'mailer-daemon@corp.com' } },
            subject: 'Mail delivery failed',
            bodyPreview: 'Reporting-MTA: dns; mx.corp.com\nFinal-Recipient: rfc822; Bob@Corp.com\nStatus: 5.1.1',
          },
        ],
      }),
    );
    const driver = new GraphDriver('graph-prod', { accessToken: 'TOK', fetchImpl: fetchImpl as unknown as typeof fetch });
    const replies = await driver.fetchReplies({ since: '2026-05-28T00:00:00.000Z' });
    expect(replies[0]!.failedRecipient).toBe('bob@corp.com');
  });

  it('recovers the failed recipient from a subject-only NDR (non-system sender)', async () => {
    const fetchImpl = vi.fn(async (_u: string, _i?: RequestInit) =>
      String(_u).includes('/$value') ? resp({}, false, 404) : resp({
        value: [
          {
            id: 'ndr3',
            from: { emailAddress: { address: 'bounces@mailgun.example' } },
            subject: 'Returned mail: see transcript for details',
            bodyPreview: 'The following address failed: carol@corp.com',
          },
        ],
      }),
    );
    const driver = new GraphDriver('graph-prod', { accessToken: 'TOK', fetchImpl: fetchImpl as unknown as typeof fetch });
    const replies = await driver.fetchReplies({ since: '2026-05-28T00:00:00.000Z' });
    expect(replies[0]!.failedRecipient).toBe('carol@corp.com');
  });

  it('leaves failedRecipient unset for an ordinary (non-system) reply', async () => {
    const fetchImpl = vi.fn(async (_u: string, _i?: RequestInit) =>
      resp({ value: [{ id: 'r9', from: { emailAddress: { address: 'mike@example.com' } }, subject: 'Re: hi', bodyPreview: 'sure' }] }),
    );
    const driver = new GraphDriver('graph-dev', { accessToken: 'TOK', fetchImpl: fetchImpl as unknown as typeof fetch });
    const replies = await driver.fetchReplies({ since: '2026-05-28T00:00:00.000Z' });
    expect(replies[0]!.failedRecipient).toBeUndefined();
  });
});

describe('GraphDriver auth + headers + DSN recovery', () => {
  it('throws GRAPH_UNAUTHORIZED on a 401 send (so the manual path can prompt re-auth)', async () => {
    const fetchImpl = vi.fn(async () => resp({}, false, 401));
    const driver = new GraphDriver('graph-prod', { accessToken: 'TOK', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(driver.send({ from: 'm@x', to: ['a@x'], subject: 's' })).rejects.toMatchObject({
      code: 'GRAPH_UNAUTHORIZED',
    });
  });

  it('throws GRAPH_UNAUTHORIZED on a 401 fetchReplies', async () => {
    const fetchImpl = vi.fn(async () => resp({}, false, 401));
    const driver = new GraphDriver('graph-prod', { accessToken: 'TOK', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(driver.fetchReplies({ since: '2026-05-28T00:00:00.000Z' })).rejects.toMatchObject({
      code: 'GRAPH_UNAUTHORIZED',
    });
  });

  it('maps message.headers to Graph internetMessageHeaders', async () => {
    const fetchImpl = vi.fn(async (_u: string, _i?: RequestInit) => resp({}, true, 202));
    const driver = new GraphDriver('graph-prod', { accessToken: 'TOK', fetchImpl: fetchImpl as unknown as typeof fetch });
    await driver.send({ from: 'm@x', to: ['a@x'], subject: 's', headers: { 'List-Unsubscribe': '<https://x/u>' } });
    const sent = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(sent.message.internetMessageHeaders).toEqual([{ name: 'List-Unsubscribe', value: '<https://x/u>' }]);
  });

  it('upgrades the failed recipient from the raw MIME delivery-status part', async () => {
    const list = {
      value: [{ id: 'ndr9', from: { emailAddress: { address: 'postmaster@corp.com' } }, subject: 'Undeliverable', bodyPreview: 'delivery failed' }],
    };
    const mime =
      'From: postmaster@corp.com\r\nContent-Type: message/delivery-status\r\n\r\nReporting-MTA: dns; corp.com\r\nFinal-Recipient: rfc822; Dave@Corp.com\r\nAction: failed\r\nStatus: 5.1.1\r\n';
    const fetchImpl = vi.fn(async (u: string) => (String(u).includes('/$value') ? rawResp(mime) : resp(list)));
    const driver = new GraphDriver('graph-prod', { accessToken: 'TOK', fetchImpl: fetchImpl as unknown as typeof fetch });
    const replies = await driver.fetchReplies({ since: '2026-05-28T00:00:00.000Z' });
    expect(replies[0]!.failedRecipient).toBe('dave@corp.com');
  });

  it('does not mis-correlate a bounce to the NDR sender mentioned first in the body', async () => {
    // The generic bounce mailbox (not a "system sender") appears before the real
    // failed recipient — the fallback must skip the message's own sender.
    const list = {
      value: [
        {
          id: 'ndr11',
          from: { emailAddress: { address: 'bounces@mailgun.example' } },
          subject: 'Returned mail: see transcript',
          bodyPreview: 'Delivery to bounces@mailgun.example failed permanently for carol@corp.com',
        },
      ],
    };
    const fetchImpl = vi.fn(async (u: string) => (String(u).includes('/$value') ? resp({}, false, 404) : resp(list)));
    const driver = new GraphDriver('graph-prod', { accessToken: 'TOK', fetchImpl: fetchImpl as unknown as typeof fetch });
    const replies = await driver.fetchReplies({ since: '2026-05-28T00:00:00.000Z' });
    expect(replies[0]!.failedRecipient).toBe('carol@corp.com');
  });

  it('decodes numeric HTML entities in the body to find the failed address', async () => {
    const list = {
      value: [
        {
          id: 'ndr12',
          from: { emailAddress: { address: 'mailer-daemon@corp.com' } },
          subject: 'Undeliverable',
          body: { contentType: 'html', content: '<p>Failed: alice&#64;corp.com</p>' },
        },
      ],
    };
    const fetchImpl = vi.fn(async (u: string) => (String(u).includes('/$value') ? resp({}, false, 404) : resp(list)));
    const driver = new GraphDriver('graph-prod', { accessToken: 'TOK', fetchImpl: fetchImpl as unknown as typeof fetch });
    const replies = await driver.fetchReplies({ since: '2026-05-28T00:00:00.000Z' });
    expect(replies[0]!.failedRecipient).toBe('alice@corp.com');
  });

  it('retries the send without headers when the tenant rejects internetMessageHeaders', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (_u: string, init?: RequestInit) => {
      calls += 1;
      const sent = JSON.parse((init?.body as string) ?? '{}');
      // First attempt carries the header and is rejected (400); the retry has no
      // headers and succeeds (202) — the email still goes out.
      return sent.message?.internetMessageHeaders ? resp({}, false, 400) : resp({}, true, 202);
    });
    const driver = new GraphDriver('graph-prod', { accessToken: 'TOK', fetchImpl: fetchImpl as unknown as typeof fetch });
    const ref = await driver.send({ from: 'm@x', to: ['a@x'], subject: 's', headers: { 'List-Unsubscribe': '<https://x/u>' } });
    expect(ref.messageId).toBeTruthy();
    expect(calls).toBe(2);
  });

  it('parses Final-Recipient from the full body when $value is unavailable', async () => {
    const list = {
      value: [
        {
          id: 'ndr10',
          from: { emailAddress: { address: 'mailer-daemon@corp.com' } },
          subject: 'Mail delivery failed',
          bodyPreview: 'truncated…',
          body: { contentType: 'text', content: 'blah\nFinal-Recipient: rfc822; Erin@Corp.com\nStatus: 5.0.0' },
        },
      ],
    };
    const fetchImpl = vi.fn(async (u: string) => (String(u).includes('/$value') ? resp({}, false, 404) : resp(list)));
    const driver = new GraphDriver('graph-prod', { accessToken: 'TOK', fetchImpl: fetchImpl as unknown as typeof fetch });
    const replies = await driver.fetchReplies({ since: '2026-05-28T00:00:00.000Z' });
    expect(replies[0]!.failedRecipient).toBe('erin@corp.com');
  });
});

describe('GraphDriver mailbox addressing (app-only vs delegated)', () => {
  it('targets /users/{mailbox} when a mailbox is set (app-only cron token)', async () => {
    const fetchImpl = vi.fn(async (_u: string, _i?: RequestInit) => resp({}, true, 202));
    const driver = new GraphDriver('graph-prod', {
      accessToken: 'APPONLY',
      mailbox: 'sender@displaynote.com',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await driver.send({ from: 'sender@displaynote.com', to: ['a@x'], subject: 's' });
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('/users/sender%40displaynote.com/sendMail');
  });

  it('targets /me when no mailbox is set (delegated user token)', async () => {
    const fetchImpl = vi.fn(async (_u: string, _i?: RequestInit) => resp({}, true, 202));
    const driver = new GraphDriver('graph-prod', { accessToken: 'TOK', fetchImpl: fetchImpl as unknown as typeof fetch });
    await driver.send({ from: 'm@x', to: ['a@x'], subject: 's' });
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('/me/sendMail');
  });
});
