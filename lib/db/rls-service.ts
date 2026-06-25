import { withRls } from '@/lib/db/rls';
import type { DrizzleTx } from '@/lib/db/rls';

/**
 * Org-scoped DB access for trusted server paths that have NO user session: the
 * email cron (running for CRON_ORG_ID) and the unsubscribe route (the org
 * baked into the signed token). It runs `fn` inside withRls with userId = null,
 * so the org-scoped RLS policies apply for `orgId` while user-scoped policies
 * (user_settings, user_graph_tokens, "users update own profile") correctly deny
 * — there is no acting user.
 *
 * The caller MUST source `orgId` from trusted input only (an env var or a
 * verified token), never from a request the end user can forge: this is the
 * one place RLS's identity is asserted without an authenticated session.
 */
export function withServiceRls<T>(
  orgId: string,
  fn: (tx: DrizzleTx) => Promise<T>,
): Promise<T> {
  return withRls({ userId: null, orgId }, fn);
}
