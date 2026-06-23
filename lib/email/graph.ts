import { randomUUID } from 'node:crypto';
import { isSystemSender, isNdrSubject } from '@/lib/email/classify';
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

// RFC 3464 delivery-status field naming the address that failed.
const DSN_RECIPIENT = /(?:final|original)-recipient:\s*(?:rfc822;)?\s*([^\s;]+@[^\s;]+)/i;
const ANY_EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/**
 * Best-effort recovery of the failed recipient from an NDR's available text
 * (subject + body preview). Prefers an RFC 3464 `Final-Recipient`/`Original-
 * Recipient` line; otherwise the first non-system email address mentioned.
 * Returns undefined when nothing recoverable — the scanner then ignores the
 * bounce rather than mis-correlating it. (Full `message/delivery-status` MIME
 * parsing against a real tenant is a fast-follow; this handles the common case
 * where the failed address appears in the preview text.)
 */
function parseFailedRecipient(text: string): string | undefined {
  const dsn = DSN_RECIPIENT.exec(text);
  if (dsn?.[1]) return dsn[1].toLowerCase();
  for (const addr of text.match(ANY_EMAIL) ?? []) {
    if (!isSystemSender(addr)) return addr.toLowerCase();
  }
  return undefined;
}

/** Strip tags/entities enough for the DSN regexes to read an HTML NDR body. */
function htmlToText(content: string): string {
  return content
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

interface GraphDriverOptions {
  /** Delegated access token (Mail.Send / Mail.Read). Deploy-time wiring. */
  accessToken?: string;
  fetchImpl?: typeof fetch;
}

/** Shape of a Graph message in a `/messages` list response (fields we map). */
interface GraphMessage {
  id?: string;
  internetMessageId?: string;
  conversationId?: string;
  subject?: string;
  from?: { emailAddress?: { address?: string } };
  toRecipients?: { emailAddress?: { address?: string } }[];
  receivedDateTime?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
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
    const headers = message.headers ?? {};
    const internetMessageHeaders = Object.entries(headers).map(([name, value]) => ({ name, value }));
    const payload = {
      message: {
        subject: message.subject,
        body: { contentType: message.bodyHtml ? 'HTML' : 'Text', content: message.bodyHtml ?? message.bodyText ?? '' },
        toRecipients: message.to.map((address) => ({ emailAddress: { address } })),
        ccRecipients: (message.cc ?? []).map((address) => ({ emailAddress: { address } })),
        bccRecipients: (message.bcc ?? []).map((address) => ({ emailAddress: { address } })),
        // Graph maps extra headers (e.g. List-Unsubscribe) via internetMessageHeaders.
        // Some tenants only accept `x-`-prefixed custom headers; if List-Unsubscribe
        // is rejected the visible footer link added by the runner still works.
        ...(internetMessageHeaders.length > 0 ? { internetMessageHeaders } : {}),
      },
      saveToSentItems: true,
    };
    const resp = await this.call('POST', '/me/sendMail', payload);
    if (resp.status === 401) {
      throw new EmailDriverError(
        'Microsoft sign-in expired or email access was revoked. Sign out and sign back in to ' +
          're-grant Mail.Send / Mail.Read, then retry.',
        undefined,
        'GRAPH_UNAUTHORIZED',
      );
    }
    if (!resp.ok) {
      throw new EmailDriverError(`Graph sendMail failed (${resp.status})`, undefined, 'GRAPH_SEND');
    }
    // sendMail returns 202 with no body; synthesise a process-independent unique
    // id for dedup (a per-instance counter + ms clock could collide).
    return {
      messageId: message.correlationId ?? `graph-${this.name}-${randomUUID()}`,
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
    // Follow @odata.nextLink to drain every page. Reading only the first page
    // would let the scanner advance its high-water mark while later pages (e.g.
    // many messages sharing one receivedDateTime) go unprocessed forever.
    const out: InboundMessage[] = [];
    let resp = await this.call('GET', `/me/mailFolders/Inbox/messages?${params.toString()}`);
    for (;;) {
      if (resp.status === 401) {
        throw new EmailDriverError(
          'Microsoft sign-in expired or email access was revoked. Sign out and sign back in to ' +
            're-grant Mail.Send / Mail.Read, then retry.',
          undefined,
          'GRAPH_UNAUTHORIZED',
        );
      }
      if (!resp.ok) {
        throw new EmailDriverError(`Graph fetchReplies failed (${resp.status})`, undefined, 'GRAPH_FETCH');
      }
      const body = (await resp.json()) as { value?: GraphMessage[]; '@odata.nextLink'?: string };
      for (const m of body.value ?? []) {
        const inbound = this.toInbound(m);
        // For an NDR, the authoritative failed address lives in the
        // `message/delivery-status` MIME part, not the human-readable body. Fetch
        // the raw MIME and parse it; fall back to the body-derived guess on any
        // error so a bounce is never dropped just because $value was unavailable.
        if (m.id && (isSystemSender(inbound.from) || isNdrSubject(inbound.subject))) {
          const recovered = await this.recoverFailedRecipientFromMime(m.id);
          if (recovered) inbound.failedRecipient = recovered;
        }
        out.push(inbound);
      }
      const next = body['@odata.nextLink'];
      if (!next) return out;
      resp = await this.callUrl('GET', next); // nextLink is an absolute Graph URL
    }
  }

  /**
   * Fetch a message's raw MIME (`/$value`) and recover the failed recipient from
   * its RFC 3464 `message/delivery-status` part. Best-effort: returns undefined
   * (not throws) on any failure, so the caller keeps its body-derived guess.
   */
  private async recoverFailedRecipientFromMime(messageId: string): Promise<string | undefined> {
    try {
      const resp = await this.call('GET', `/me/messages/${encodeURIComponent(messageId)}/$value`);
      if (!resp.ok) return undefined;
      // STRICT: trust only the authoritative RFC 3464 Final/Original-Recipient
      // line here, NOT parseFailedRecipient's "first non-system address" fallback
      // — raw MIME is full of other addresses (From, Reporting-MTA, the original
      // headers) that the fallback would wrongly latch onto. No DSN line → leave
      // the body-derived guess in place.
      const dsn = DSN_RECIPIENT.exec(await resp.text());
      return dsn?.[1] ? dsn[1].toLowerCase() : undefined;
    } catch {
      return undefined;
    }
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
    // A real NDR is sent from postmaster@…/mailer-daemon@… with the FAILED
    // RECIPIENT in the delivery-status report, not in `from`. We surface that
    // recipient as `failedRecipient` (best-effort, from the preview text) so the
    // scanner can correlate/suppress the prospect; if it can't be recovered the
    // bounce is ignored rather than mis-correlated (see parseFailedRecipient).
    const from = m.from?.emailAddress?.address ?? '';
    const out: InboundMessage = {
      // Fall back to Graph's stable `id` so distinct messages don't collapse to
      // one '' message_id under the (org, provider, message_id) dedup.
      messageId: m.internetMessageId ?? m.id ?? '',
      from,
      to: (m.toRecipients ?? []).map((r) => r.emailAddress?.address ?? '').filter(Boolean),
      subject: m.subject ?? '',
      receivedAt: m.receivedDateTime ?? new Date().toISOString(),
    };
    if (m.bodyPreview !== undefined) out.bodyText = m.bodyPreview;
    if (m.conversationId !== undefined) out.conversationId = m.conversationId;
    // Recover the failed recipient for ANYTHING the classifier treats as a
    // bounce — a system-mailer sender OR an undeliverable subject (some MTAs
    // bounce from a non-postmaster address) — so subject-only NDRs correlate to
    // the prospect instead of the (wrong) sender.
    const subject = m.subject ?? '';
    if (isSystemSender(from) || isNdrSubject(subject)) {
      // Parse the FULL body (not just the preview) — the Final-Recipient DSN line
      // is often past the preview cutoff. fetchReplies further upgrades this from
      // the raw MIME delivery-status part when available.
      const bodyText = m.body?.content ? htmlToText(m.body.content) : (m.bodyPreview ?? '');
      const failed = parseFailedRecipient(`${subject}\n${bodyText}`);
      if (failed !== undefined) out.failedRecipient = failed;
    }
    return out;
  }

  private async call(method: string, path: string, body?: unknown): Promise<Response> {
    return this.callUrl(method, `${GRAPH_BASE}${path}`, body);
  }

  /** Like {@link call} but takes an absolute URL (used to follow @odata.nextLink). */
  private async callUrl(method: string, url: string, body?: unknown): Promise<Response> {
    return this.fetchImpl(url, {
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
