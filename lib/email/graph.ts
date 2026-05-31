import type { EmailDriver } from '@/lib/email/driver';
import {
  EmailDriverError,
  NotImplementedError,
  type InboundMessage,
  type OutboundMessage,
  type SentRef,
  type Subscription,
} from '@/lib/email/types';

export type GraphEnvironment = 'graph-dev' | 'graph-prod';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

interface GraphDriverOptions {
  /** Delegated access token (Mail.Send / Mail.Read). Deploy-time wiring. */
  accessToken?: string;
  fetchImpl?: typeof fetch;
}

/** Shape of a Graph message in a `/messages` list response (fields we map). */
interface GraphMessage {
  internetMessageId?: string;
  conversationId?: string;
  subject?: string;
  from?: { emailAddress?: { address?: string } };
  toRecipients?: { emailAddress?: { address?: string } }[];
  receivedDateTime?: string;
  bodyPreview?: string;
}

/**
 * Microsoft Graph email driver (PHASE_5_SPEC §9). `send` → `POST /me/sendMail`;
 * `fetchReplies` → a `receivedDateTime ge <since>` query on the Inbox. The
 * delegated token is injected (from the user's Supabase Azure session at
 * deploy time); this path is structurally complete but not exercised in
 * local/CI runs (the `mock` driver is the local path). `fetch` is injectable
 * for unit testing the request shapes.
 *
 * Note: `sendMail` is fire-and-forget (202, no body), so `send` returns a
 * generated `messageId` for dedup; reply correlation relies on the inbound
 * `conversationId` / sender address.
 */
export class GraphDriver implements EmailDriver {
  readonly name: GraphEnvironment;
  private readonly accessToken: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private sendCounter = 0;

  constructor(env: GraphEnvironment, opts: GraphDriverOptions = {}) {
    this.name = env;
    this.accessToken = opts.accessToken;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private token(): string {
    if (!this.accessToken) {
      throw new EmailDriverError('GraphDriver: no delegated access token configured', undefined, 'GRAPH_NO_TOKEN');
    }
    return this.accessToken;
  }

  async send(message: OutboundMessage): Promise<SentRef> {
    const payload = {
      message: {
        subject: message.subject,
        body: { contentType: message.bodyHtml ? 'HTML' : 'Text', content: message.bodyHtml ?? message.bodyText ?? '' },
        toRecipients: message.to.map((address) => ({ emailAddress: { address } })),
        ccRecipients: (message.cc ?? []).map((address) => ({ emailAddress: { address } })),
        bccRecipients: (message.bcc ?? []).map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: true,
    };
    const resp = await this.call('POST', '/me/sendMail', payload);
    if (!resp.ok) {
      throw new EmailDriverError(`Graph sendMail failed (${resp.status})`, undefined, 'GRAPH_SEND');
    }
    // sendMail returns 202 with no body; synthesise a correlation id for dedup.
    this.sendCounter += 1;
    return {
      messageId: message.correlationId ?? `graph-${this.name}-${Date.now()}-${this.sendCounter}`,
      provider: this.name,
      sentAt: new Date().toISOString(),
    };
  }

  async fetchReplies(opts: { since: string; mailbox?: string }): Promise<InboundMessage[]> {
    const params = new URLSearchParams({
      $filter: `receivedDateTime ge ${opts.since}`,
      $top: '50',
      $orderby: 'receivedDateTime asc',
    });
    const resp = await this.call('GET', `/me/mailFolders/Inbox/messages?${params.toString()}`);
    if (!resp.ok) {
      throw new EmailDriverError(`Graph fetchReplies failed (${resp.status})`, undefined, 'GRAPH_FETCH');
    }
    const body = (await resp.json()) as { value?: GraphMessage[] };
    return (body.value ?? []).map((m) => this.toInbound(m));
  }

  async subscribeReplies(_opts: {
    notificationUrl: string;
    mailbox?: string;
    expirationMinutes?: number;
  }): Promise<Subscription> {
    // Real-time change-notification subscriptions are a deferred fast-follow
    // (PHASE_5_SPEC §0 / DECISION 13.1); the polling fetchReplies path is used.
    throw new NotImplementedError('GraphDriver.subscribeReplies');
  }

  private toInbound(m: GraphMessage): InboundMessage {
    const out: InboundMessage = {
      messageId: m.internetMessageId ?? '',
      from: m.from?.emailAddress?.address ?? '',
      to: (m.toRecipients ?? []).map((r) => r.emailAddress?.address ?? '').filter(Boolean),
      subject: m.subject ?? '',
      receivedAt: m.receivedDateTime ?? new Date().toISOString(),
    };
    if (m.bodyPreview !== undefined) out.bodyText = m.bodyPreview;
    if (m.conversationId !== undefined) out.conversationId = m.conversationId;
    return out;
  }

  private async call(method: string, path: string, body?: unknown): Promise<Response> {
    return this.fetchImpl(`${GRAPH_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token()}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }
}
