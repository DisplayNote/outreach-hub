import type { EmailDriver } from '@/lib/email/driver';
import { GraphDriver, type GraphEnvironment } from '@/lib/email/graph';
import { MailpitDriver } from '@/lib/email/mailpit';
import { MockDriver } from '@/lib/email/mock';

export type EmailDriverName = 'mock' | 'mailpit' | GraphEnvironment;

/**
 * Build the configured EmailDriver. For `graph-*`, callers pass identity via opts:
 *   - the CRON path acquires an app-only token via MSAL (`appOnlyGraphToken()`) and
 *     passes it as `opts.accessToken` plus `opts.mailbox` (the shared org mailbox) —
 *     it never relies on `GRAPH_ACCESS_TOKEN` at the env level;
 *   - the MANUAL (per-user) path passes the SIGNED-IN USER'S delegated token as
 *     `opts.accessToken`, so it sends from / scans that user's own mailbox — never
 *     the shared cron mailbox (which would cross-apply inbound across orgs/users).
 * With neither token, Graph send/fetch throw GRAPH_NO_TOKEN rather than no-op.
 */
export function getEmailDriver(opts: { accessToken?: string; mailbox?: string } = {}): EmailDriver {
  const driver = process.env.EMAIL_DRIVER as EmailDriverName | undefined;

  switch (driver) {
    case undefined:
      // Default to mock locally, but FAIL CLOSED in production: an unset
      // EMAIL_DRIVER there would silently use the in-memory MockDriver, marking
      // contacts sent and advancing sequences without delivering any mail. Set
      // EMAIL_DRIVER explicitly in production (graph-prod, or mock to opt in).
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'EMAIL_DRIVER is not set. Refusing to default to the in-memory mock driver in ' +
            'production (it would mark contacts sent without delivering mail). Set EMAIL_DRIVER explicitly.',
        );
      }
      return new MockDriver();
    case 'mock':
      return new MockDriver();
    case 'mailpit':
      return new MailpitDriver();
    case 'graph-dev':
    case 'graph-prod': {
      return new GraphDriver(driver, {
        // Callers must pass opts.accessToken explicitly: the cron path via MSAL
        // appOnlyGraphToken(), the manual path via the user's delegated token.
        // No env-var fallback — GraphDriver throws GRAPH_NO_TOKEN when absent.
        ...(opts.accessToken ? { accessToken: opts.accessToken } : {}),
        // mailbox set → app-only path (/users/{mailbox}); absent → delegated (/me).
        ...(opts.mailbox ? { mailbox: opts.mailbox } : {}),
      });
    }
    default:
      throw new Error(`Unknown EMAIL_DRIVER: ${driver as string}`);
  }
}

export type { EmailDriver };
export { MockDriver, MailpitDriver, GraphDriver };
