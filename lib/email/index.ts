import type { EmailDriver } from '@/lib/email/driver';
import { GraphDriver, type GraphEnvironment } from '@/lib/email/graph';
import { MailpitDriver } from '@/lib/email/mailpit';
import { MockDriver } from '@/lib/email/mock';

export type EmailDriverName = 'mock' | 'mailpit' | GraphEnvironment;

export function getEmailDriver(): EmailDriver {
  const driver = process.env.EMAIL_DRIVER as EmailDriverName | undefined;

  switch (driver) {
    case 'mock':
    case undefined:
      return new MockDriver();
    case 'mailpit':
      return new MailpitDriver();
    case 'graph-dev':
    case 'graph-prod':
      return new GraphDriver(driver);
    default:
      throw new Error(`Unknown EMAIL_DRIVER: ${driver as string}`);
  }
}

export type { EmailDriver };
export { MockDriver, MailpitDriver, GraphDriver };
