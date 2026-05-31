import type { EmailDriver } from '@/lib/email/driver';
import type {
  InboundMessage,
  OutboundMessage,
  SentRef,
  Subscription,
} from '@/lib/email/types';

let counter = 0;

export class MockDriver implements EmailDriver {
  readonly name = 'mock';

  /** Messages successfully "sent". Reset via {@link reset}. */
  readonly sent: { message: OutboundMessage; ref: SentRef }[] = [];

  /** Canned inbound replies returned by {@link fetchReplies}. Populate in tests. */
  readonly inbound: InboundMessage[] = [];

  async send(message: OutboundMessage): Promise<SentRef> {
    counter += 1;
    const ref: SentRef = {
      messageId: `mock-${counter}-${Date.now()}`,
      provider: this.name,
      sentAt: new Date().toISOString(),
    };
    this.sent.push({ message, ref });
    return ref;
  }

  async fetchReplies(opts: { since: string; mailbox?: string }): Promise<InboundMessage[]> {
    const sinceMs = Date.parse(opts.since);
    return this.inbound.filter((m) => Date.parse(m.receivedAt) >= sinceMs);
  }

  async subscribeReplies(opts: {
    notificationUrl: string;
    mailbox?: string;
    expirationMinutes?: number;
  }): Promise<Subscription> {
    const expiresInMs = (opts.expirationMinutes ?? 60) * 60_000;
    return {
      id: `mock-sub-${++counter}`,
      notificationUrl: opts.notificationUrl,
      expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
    };
  }

  /**
   * Dev/test simulator: enqueue an inbound reply from a contact so a later
   * `fetchReplies` (and the scanner) sees it. `from` is the contact's address so
   * the scanner correlates by sender; `inReplyTo`/`conversationId` let it
   * correlate to a prior sent event too (PHASE_5_SPEC §9).
   */
  simulateReply(opts: {
    from: string;
    inReplyTo?: string;
    conversationId?: string;
    subject?: string;
    receivedAt?: string;
  }): InboundMessage {
    counter += 1;
    const message: InboundMessage = {
      messageId: `mock-in-${counter}-${Date.now()}`,
      from: opts.from,
      to: ['me@local'],
      subject: opts.subject ?? 'Re: your message',
      receivedAt: opts.receivedAt ?? new Date().toISOString(),
      ...(opts.inReplyTo !== undefined ? { inReplyTo: opts.inReplyTo } : {}),
      ...(opts.conversationId !== undefined ? { conversationId: opts.conversationId } : {}),
    };
    this.inbound.push(message);
    return message;
  }

  /**
   * Dev/test simulator: enqueue a bounce/NDR for a failed recipient. The failed
   * recipient is the `from` (so the scanner correlates by sender) and the
   * subject triggers NDR classification. (A real Graph NDR comes from postmaster
   * with the failed recipient in the body; the Graph driver maps that recipient
   * into `from` so the scanner stays uniform.)
   */
  simulateBounce(opts: { recipient: string; subject?: string; receivedAt?: string }): InboundMessage {
    counter += 1;
    const message: InboundMessage = {
      messageId: `mock-ndr-${counter}-${Date.now()}`,
      from: opts.recipient,
      to: ['me@local'],
      subject: opts.subject ?? 'Undeliverable: message not delivered',
      receivedAt: opts.receivedAt ?? new Date().toISOString(),
    };
    this.inbound.push(message);
    return message;
  }

  reset(): void {
    this.sent.length = 0;
    this.inbound.length = 0;
  }
}
