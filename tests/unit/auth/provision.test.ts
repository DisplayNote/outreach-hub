import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

// Integration test: gated on local Postgres. Skipped when DATABASE_URL_TEST is
// unset so the unit suite stays runnable without a database.
const maybe = process.env.DATABASE_URL_TEST ? describe : describe.skip;

beforeAll(() => {
  // The db client reads server env at import time; point DATABASE_URL at the
  // test DB and satisfy the public env schema.
  if (process.env.DATABASE_URL_TEST) {
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'anon-key';
});

const TEST_EMAIL = `provision-test+${Date.now()}@outreach.local`;

async function cleanup(): Promise<void> {
  // Admin connection (postgres) tears down the test artefacts the SECURITY
  // DEFINER function created; app_user cannot delete cross-org rows.
  const { Client } = await import('pg');
  const admin = new Client({
    connectionString: process.env.DATABASE_URL_ADMIN,
    ssl: false,
  });
  await admin.connect();
  const r = await admin.query('select id, org_id from public.users where lower(email) = lower($1)', [
    TEST_EMAIL,
  ]);
  for (const row of r.rows) {
    await admin.query('delete from public.users where id = $1', [row.id]);
    await admin.query('delete from public.organizations where id = $1', [row.org_id]);
    await admin.query('delete from auth.users where id = $1', [row.id]);
  }
  await admin.end();
}

maybe('provisionUser', () => {
  afterAll(cleanup);

  it('provisions an unknown email: creates org + user as owner', async () => {
    const { provisionUser } = await import('@/lib/auth/provision');
    const res = await provisionUser({ email: TEST_EMAIL, name: 'Provision Test' });
    expect(res.userId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.orgId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.role).toBe('owner');
  });

  it('is idempotent: a known email returns the same row (no duplicate org)', async () => {
    const { provisionUser } = await import('@/lib/auth/provision');
    const first = await provisionUser({ email: TEST_EMAIL, name: 'Provision Test' });
    const second = await provisionUser({ email: TEST_EMAIL });
    expect(second.userId).toBe(first.userId);
    expect(second.orgId).toBe(first.orgId);
    expect(second.role).toBe(first.role);

    // Exactly one user row for this email. Count via the admin connection: as
    // app_user with no org GUC set, RLS hides the row entirely (proving the row
    // is real but org-scoped — visibility is exercised in the next test).
    const { Client } = await import('pg');
    const admin = new Client({ connectionString: process.env.DATABASE_URL_ADMIN, ssl: false });
    await admin.connect();
    const count = await admin.query(
      'select count(*)::int as n from public.users where lower(email) = lower($1)',
      [TEST_EMAIL],
    );
    await admin.end();
    expect(count.rows[0].n).toBe(1);
  });

  it('persists a row visible to RLS once the org GUC is set', async () => {
    const { provisionUser } = await import('@/lib/auth/provision');
    const { withRls } = await import('@/lib/db/rls');
    const res = await provisionUser({ email: TEST_EMAIL, name: 'Provision Test' });
    const seen = await withRls({ userId: res.userId, orgId: res.orgId }, async (tx) => {
      const r = await tx.execute(
        sql`select email from public.users where id = ${res.userId}`,
      );
      return r.rows[0] as { email: string } | undefined;
    });
    expect(seen?.email?.toLowerCase()).toBe(TEST_EMAIL.toLowerCase());
  });
});
