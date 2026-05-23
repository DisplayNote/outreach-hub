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

  reset(): void {
    this.sent.length = 0;
    this.inbound.length = 0;
  }
}
