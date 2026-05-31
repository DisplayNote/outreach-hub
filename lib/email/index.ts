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
      // Pass a configured token if present so the Graph driver is usable. The
      // proper per-user delegated token (from the user's Supabase Azure session)
      // is injected at the call site at deploy time; without either, send/fetch
      // throw GRAPH_NO_TOKEN rather than silently no-op.
      return new GraphDriver(
        driver,
        process.env.GRAPH_ACCESS_TOKEN ? { accessToken: process.env.GRAPH_ACCESS_TOKEN } : {},
      );
    default:
      throw new Error(`Unknown EMAIL_DRIVER: ${driver as string}`);
  }
}

export type { EmailDriver };
export { MockDriver, MailpitDriver, GraphDriver };
