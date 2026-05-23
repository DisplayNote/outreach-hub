import { beforeEach, describe, expect, it } from 'vitest';
import { MockDriver } from '@/lib/email/mock';
import { getEmailDriver } from '@/lib/email/index';

describe('MockDriver', () => {
  let driver: MockDriver;

  beforeEach(() => {
    driver = new MockDriver();
  });

  it('records sent messages and returns a SentRef', async () => {
    const ref = await driver.send({
      from: 'mike@displaynote.com',
      to: ['paul@example.com'],
      subject: 'Hello',
      bodyText: 'world',
    });

    expect(ref.provider).toBe('mock');
    expect(ref.messageId).toMatch(/^mock-/);
    expect(driver.sent).toHaveLength(1);
    expect(driver.sent[0]?.message.subject).toBe('Hello');
  });

  it('filters inbound replies by since timestamp', async () => {
    driver.inbound.push(
      {
        messageId: 'r1',
        from: 'paul@example.com',
        to: ['mike@displaynote.com'],
        subject: 'Re: Hello',
        receivedAt: '2026-05-01T00:00:00.000Z',
      },
      {
        messageId: 'r2',
        from: 'paul@example.com',
        to: ['mike@displaynote.com'],
        subject: 'Re: Hello again',
        receivedAt: '2026-05-23T00:00:00.000Z',
      },
    );

    const replies = await driver.fetchReplies({ since: '2026-05-15T00:00:00.000Z' });
    expect(replies.map((r) => r.messageId)).toEqual(['r2']);
  });

  it('reset() clears recorded state', async () => {
    await driver.send({ from: 'a@x', to: ['b@x'], subject: 's' });
    driver.inbound.push({
      messageId: 'r1',
      from: 'a@x',
      to: ['b@x'],
      subject: 's',
      receivedAt: new Date().toISOString(),
    });

    driver.reset();
    expect(driver.sent).toHaveLength(0);
    expect(driver.inbound).toHaveLength(0);
  });

  it('factory returns a MockDriver when EMAIL_DRIVER=mock', () => {
    const original = process.env.EMAIL_DRIVER;
    process.env.EMAIL_DRIVER = 'mock';
    try {
      const d = getEmailDriver();
      expect(d.name).toBe('mock');
    } finally {
      if (original === undefined) delete process.env.EMAIL_DRIVER;
      else process.env.EMAIL_DRIVER = original;
    }
  });
});
