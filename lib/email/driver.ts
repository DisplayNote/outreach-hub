import type {
  InboundMessage,
  OutboundMessage,
  SentRef,
  Subscription,
} from '@/lib/email/types';

export interface EmailDriver {
  readonly name: string;

  send(message: OutboundMessage): Promise<SentRef>;

  fetchReplies(opts: { since: string; mailbox?: string }): Promise<InboundMessage[]>;

  subscribeReplies?(opts: {
    notificationUrl: string;
    mailbox?: string;
    expirationMinutes?: number;
  }): Promise<Subscription>;
}
