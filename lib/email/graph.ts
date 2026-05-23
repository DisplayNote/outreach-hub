import type { EmailDriver } from '@/lib/email/driver';
import {
  NotImplementedError,
  type InboundMessage,
  type OutboundMessage,
  type SentRef,
  type Subscription,
} from '@/lib/email/types';

export type GraphEnvironment = 'graph-dev' | 'graph-prod';

/**
 * Stub. The real Graph driver lands in Phase 5 — it will exchange the user's delegated token,
 * call `/me/sendMail` and subscribe to `/me/messages` change notifications. The class exists
 * today so the factory typechecks.
 */
export class GraphDriver implements EmailDriver {
  readonly name: GraphEnvironment;

  constructor(env: GraphEnvironment) {
    this.name = env;
  }

  async send(_message: OutboundMessage): Promise<SentRef> {
    throw new NotImplementedError('GraphDriver.send');
  }

  async fetchReplies(_opts: { since: string; mailbox?: string }): Promise<InboundMessage[]> {
    throw new NotImplementedError('GraphDriver.fetchReplies');
  }

  async subscribeReplies(_opts: {
    notificationUrl: string;
    mailbox?: string;
    expirationMinutes?: number;
  }): Promise<Subscription> {
    throw new NotImplementedError('GraphDriver.subscribeReplies');
  }
}
