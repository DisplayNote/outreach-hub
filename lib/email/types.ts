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
  /**
   * For a bounce/NDR: the original failed recipient (the prospect), recovered
   * from the delivery-status report. An NDR's `from` is the system mailer, so
   * this is what the scanner correlates/suppresses on. Absent when it couldn't
   * be recovered (the bounce is then ignored, never mis-correlated).
   */
  failedRecipient?: string;
}

export interface Subscription {
  id: string;
  /** Where the provider will deliver inbound notifications. */
  notificationUrl: string;
  /** ISO timestamp the subscription stops being valid. */
  expiresAt: string;
}

// --- Phase 5 domain: email events + suppressions ----------------------------

/** public.email_events.type — a sent message, or an inbound reply/bounce. */
export type EmailEventType = 'sent' | 'reply' | 'bounce';

/** public.suppressions.reason — why an address is on the do-not-send list. */
export type SuppressionReason = 'replied' | 'bounced' | 'manual' | 'unsubscribed';

/**
 * public.email_events row (camelCase). Append-only per-message log: a `sent`
 * record per outbound, a `reply`/`bounce` per correlated inbound. `messageId`
 * is the provider id and the send-dedup key; `sequenceDay` is the step's
 * day_offset for a send (null for inbound).
 */
export interface EmailEvent {
  id: string;
  orgId: string;
  contactId: string;
  campaignId: string | null;
  type: EmailEventType;
  provider: string;
  /** The address actually emailed on a `sent` event (normalised); null for inbound.
   * Lets a bounce correlate by the address sent to even if the contact's email
   * was corrected afterwards. */
  recipient: string | null;
  messageId: string | null;
  conversationId: string | null;
  inReplyTo: string | null;
  subject: string | null;
  sequenceDay: number | null;
  payload: Record<string, unknown>;
  occurredAt: string;
  createdAt: string;
}

/** public.suppressions row (camelCase) — one do-not-send address per org. */
export interface Suppression {
  id: string;
  orgId: string;
  email: string;
  reason: SuppressionReason;
  contactId: string | null;
  createdAt: string;
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
