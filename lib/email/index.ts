import type { EmailDriver } from '@/lib/email/driver';
import { GraphDriver, type GraphEnvironment } from '@/lib/email/graph';
import { MailpitDriver } from '@/lib/email/mailpit';
import { MockDriver } from '@/lib/email/mock';

export type EmailDriverName = 'mock' | 'mailpit' | GraphEnvironment;

/**
 * Build the configured EmailDriver. For `graph-*`, `opts.accessToken` overrides
 * the deploy-wide `GRAPH_ACCESS_TOKEN`:
 *   - the CRON path calls with no token → uses GRAPH_ACCESS_TOKEN, the single
 *     configured org's mailbox (CRON_ORG_ID);
 *   - the MANUAL (per-user) path passes the SIGNED-IN USER'S delegated token, so
 *     it sends from / scans that user's own mailbox — never the shared cron token
 *     (which would send every org/user from one mailbox and cross-apply inbound).
 * With neither token, Graph send/fetch throw GRAPH_NO_TOKEN rather than no-op.
 */
export function getEmailDriver(opts: { accessToken?: string } = {}): EmailDriver {
  const driver = process.env.EMAIL_DRIVER as EmailDriverName | undefined;

  switch (driver) {
    case 'mock':
    case undefined:
      return new MockDriver();
    case 'mailpit':
      return new MailpitDriver();
    case 'graph-dev':
    case 'graph-prod': {
      const accessToken = opts.accessToken ?? process.env.GRAPH_ACCESS_TOKEN;
      return new GraphDriver(driver, accessToken ? { accessToken } : {});
    }
    default:
      throw new Error(`Unknown EMAIL_DRIVER: ${driver as string}`);
  }
}

export type { EmailDriver };
export { MockDriver, MailpitDriver, GraphDriver };
