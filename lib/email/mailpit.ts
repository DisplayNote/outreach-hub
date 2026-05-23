import nodemailer from 'nodemailer';
import type { EmailDriver } from '@/lib/email/driver';
import {
  NotImplementedError,
  type InboundMessage,
  type OutboundMessage,
  type SentRef,
} from '@/lib/email/types';

const DEFAULT_HOST = process.env.MAILPIT_HOST ?? '127.0.0.1';
const DEFAULT_PORT = Number(process.env.MAILPIT_PORT ?? 1025);

export class MailpitDriver implements EmailDriver {
  readonly name = 'mailpit';

  private readonly transporter = nodemailer.createTransport({
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    secure: false,
    auth: undefined,
  });

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

  async fetchReplies(_opts: { since: string; mailbox?: string }): Promise<InboundMessage[]> {
    throw new NotImplementedError('MailpitDriver.fetchReplies');
  }
}
