import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';

export interface RlsContext {
  userId: string | null;
  orgId: string;
}

export type DrizzleTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Run `fn` inside a transaction whose session GUCs carry the caller's identity,
 * so the RLS readers (current_org_id/current_user_id) scope every query. SET
 * LOCAL is transaction-scoped, so nothing leaks to the next pooled use.
 * `set_config(..., true)` binds the value safely (no SQL injection of the id).
 */
export function withRls<T>(ctx: RlsContext, fn: (tx: DrizzleTx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.org_id', ${ctx.orgId}, true), set_config('app.user_id', ${ctx.userId ?? ''}, true)`,
    );
    return fn(tx);
  });
}
