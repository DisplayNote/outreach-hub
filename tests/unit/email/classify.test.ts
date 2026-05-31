import { describe, it, expect } from 'vitest';
import { classifyInbound } from '@/lib/email/classify';
import type { InboundMessage } from '@/lib/email/types';

function msg(over: Partial<InboundMessage> = {}): InboundMessage {
  return {
    messageId: 'm1',
    from: 'mike@example.com',
    to: ['paul@displaynote.com'],
    subject: 'Re: quick question',
    receivedAt: '2026-05-31T10:00:00.000Z',
    ...over,
  };
}

describe('classifyInbound', () => {
  it('classifies an ordinary inbound as a reply', () => {
    expect(classifyInbound(msg({ inReplyTo: 'sent-1' }))).toBe('reply');
    expect(classifyInbound(msg({ from: 'someone@prospect.co' }))).toBe('reply');
  });

  it('classifies a postmaster / mailer-daemon sender as a bounce', () => {
    expect(classifyInbound(msg({ from: 'postmaster@example.com' }))).toBe('bounce');
    expect(classifyInbound(msg({ from: 'MAILER-DAEMON@mx.google.com' }))).toBe('bounce');
  });

  it('classifies NDR subjects as a bounce regardless of sender', () => {
    expect(classifyInbound(msg({ subject: 'Undeliverable: quick question' }))).toBe('bounce');
    expect(classifyInbound(msg({ subject: 'Delivery Status Notification (Failure)' }))).toBe('bounce');
    expect(classifyInbound(msg({ subject: 'Mail delivery failed: returning message to sender' }))).toBe('bounce');
  });

  it('is case-insensitive and tolerant of display-name senders', () => {
    expect(classifyInbound(msg({ from: 'Mail Delivery System <mailer-daemon@x.com>' }))).toBe('bounce');
  });
});
