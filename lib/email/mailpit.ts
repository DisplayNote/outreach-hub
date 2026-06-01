import nodemailer from 'nodemailer';
import type { EmailDriver } from '@/lib/email/driver';
import { EmailDriverError, type InboundMessage, type OutboundMessage, type SentRef } from '@/lib/email/types';

const DEFAULT_HOST = process.env.MAILPIT_HOST ?? '127.0.0.1';
const DEFAULT_PORT = Number(process.env.MAILPIT_PORT ?? 1025);
/** Mailpit's HTTP API (default :8025), used by fetchReplies to read the inbox. */
const API_URL = process.env.MAILPIT_API_URL ?? `http://${DEFAULT_HOST}:8025`;

/** A row from Mailpit's `GET /api/v1/messages` list. */
interface MailpitMessage {
  ID: string;
  MessageID?: string;
  From?: { Address?: string; Name?: string };
  To?: { Address?: string }[];
  Subject?: string;
  Created?: string;
  Snippet?: string;
}

/** How many messages to request per Mailpit list page. */
const PAGE_SIZE = 200;

export class MailpitDriver implements EmailDriver {
  readonly name = 'mailpit';
  private readonly fetchImpl: typeof fetch;

  private readonly transporter = nodemailer.createTransport({
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    secure: false,
    auth: undefined,
  });

  constructor(opts: { fetchImpl?: typeof fetch } = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async send(message: OutboundMessage): Promise<SentRef> {
    const info = await this.transporter.sendMail({
      from: message.from,
      to: message.to.join(', '),
      cc: message.cc?.join(', '),
      bcc: message.bcc?.join(', '),
      subject: message.subject,
      text: message.bodyText,
      html: message.bodyHtml,
      inReplyTo: message.inReplyTo,
      references: message.references,
    });

    return {
      messageId: info.messageId,
      provider: this.name,
      sentAt: new Date().toISOString(),
    };
  }

  /**
   * Read the Mailpit inbox via its HTTP API (PHASE_5_SPEC §9) — an optional,
   * higher-fidelity local path: a developer can hand-reply in the Mailpit UI and
   * the scanner picks it up. Maps to {@link InboundMessage} and filters by
   * `since`. (The default local path is the in-process `mock` driver.)
   *
   * Pages through the list (`start`/`limit`) and drains every page, so the
   * scanner can't advance its cursor past unprocessed mail when more than one
   * page arrived since the last scan.
   */
  async fetchReplies(opts: { since: string; mailbox?: string }): Promise<InboundMessage[]> {
    const sinceMs = Date.parse(opts.since);
    const out: InboundMessage[] = [];
    for (let start = 0; ; start += PAGE_SIZE) {
      const resp = await this.fetchImpl(`${API_URL}/api/v1/messages?limit=${PAGE_SIZE}&start=${start}`, {
        headers: { Accept: 'application/json' },
      });
      if (!resp.ok) {
        throw new EmailDriverError(`Mailpit fetchReplies failed (${resp.status})`, undefined, 'MAILPIT_FETCH');
      }
      const body = (await resp.json()) as { messages?: MailpitMessage[]; total?: number };
      const page = body.messages ?? [];
      for (const m of page) {
        if (m.Created && Date.parse(m.Created) < sinceMs) continue;
        out.push(this.toInbound(m));
      }
      // Stop when the last page is short, or we've walked the whole mailbox.
      if (page.length < PAGE_SIZE) break;
      if (body.total !== undefined && start + page.length >= body.total) break;
    }
    return out;
  }

  private toInbound(m: MailpitMessage): InboundMessage {
    const out: InboundMessage = {
      messageId: m.MessageID ?? m.ID,
      from: m.From?.Address ?? '',
      to: (m.To ?? []).map((t) => t.Address ?? '').filter(Boolean),
      subject: m.Subject ?? '',
      receivedAt: m.Created ?? new Date().toISOString(),
    };
    if (m.Snippet !== undefined) out.bodyText = m.Snippet;
    return out;
  }
}
