import { describe, it, expect, vi } from 'vitest';
import { GraphDriver } from '@/lib/email/graph';

function resp(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
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
      resp({
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
      resp({
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

  it('leaves failedRecipient unset for an ordinary (non-system) reply', async () => {
    const fetchImpl = vi.fn(async (_u: string, _i?: RequestInit) =>
      resp({ value: [{ id: 'r9', from: { emailAddress: { address: 'mike@example.com' } }, subject: 'Re: hi', bodyPreview: 'sure' }] }),
    );
    const driver = new GraphDriver('graph-dev', { accessToken: 'TOK', fetchImpl: fetchImpl as unknown as typeof fetch });
    const replies = await driver.fetchReplies({ since: '2026-05-28T00:00:00.000Z' });
    expect(replies[0]!.failedRecipient).toBeUndefined();
  });
});
