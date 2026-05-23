export interface OutboundMessage {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyHtml?: string;
  bodyText?: string;
  /** Optional client-side correlation id propagated through providers when supported. */
  correlationId?: string;
  /** Optional in-reply-to / references for threading. */
  inReplyTo?: string;
  references?: string[];
}

export interface SentRef {
  /** Provider-assigned message id (e.g. Graph internetMessageId, SMTP Message-Id). */
  messageId: string;
  /** Provider name that produced this id. */
  provider: string;
  /** ISO timestamp when the provider accepted the message. */
  sentAt: string;
}

export interface InboundMessage {
  messageId: string;
  from: string;
  to: string[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  receivedAt: string;
  /** Threading hints, if available. */
  inReplyTo?: string;
  references?: string[];
  conversationId?: string;
}

export interface Subscription {
  id: string;
  /** Where the provider will deliver inbound notifications. */
  notificationUrl: string;
  /** ISO timestamp the subscription stops being valid. */
  expiresAt: string;
}

export class EmailDriverError extends Error {
  public readonly code?: string;

  constructor(message: string, cause?: unknown, code?: string) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'EmailDriverError';
    if (code !== undefined) this.code = code;
  }
}

export class NotImplementedError extends EmailDriverError {
  constructor(method: string) {
    super(`${method} is not implemented in this driver`, undefined, 'NOT_IMPLEMENTED');
    this.name = 'NotImplementedError';
  }
}
