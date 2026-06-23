import { beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

// Integration test: gated on a local Postgres. Skipped when DATABASE_URL_TEST
// is unset so the unit suite stays runnable without a database.
const maybe = process.env.DATABASE_URL_TEST ? describe : describe.skip;

beforeAll(() => {
  // The db client reads server env at import time; seed the required vars and
  // point DATABASE_URL at the test DB.
  if (process.env.DATABASE_URL_TEST) {
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'anon-key';
});

maybe('withRls', () => {
  it('sets app.org_id / app.user_id as transaction-local GUCs', async () => {
    const { withRls } = await import('@/lib/db/rls');
    const seen = await withRls(
      { userId: '00000000-0000-0000-0000-000000000001', orgId: '00000000-0000-0000-0000-0000000000aa' },
      async (tx) => {
        const r = await tx.execute(
          sql`select current_setting('app.org_id', true) as org, current_setting('app.user_id', true) as usr`,
        );
        return r.rows[0];
      },
    );
    expect(seen).toEqual({
      org: '00000000-0000-0000-0000-0000000000aa',
      usr: '00000000-0000-0000-0000-000000000001',
    });
  });

  it('clears GUCs after the transaction (no leak across requests)', async () => {
    const { withRls } = await import('@/lib/db/rls');
    const { pool } = await import('@/lib/db/client');
    await withRls({ userId: null, orgId: '00000000-0000-0000-0000-0000000000bb' }, async () => {});
    const r = await pool.query("select current_setting('app.org_id', true) as org");
    expect(r.rows[0].org).toBe(''); // SET LOCAL did not escape the tx
  });
});
