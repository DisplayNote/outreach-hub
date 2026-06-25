import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { eq } from 'drizzle-orm';

// Integration test: gated on a local Postgres. Proves the multi-tenant RLS
// boundary survives the supabase-js → Drizzle rewrite — reading through withRls
// as org A can NEVER see org B's rows, and an INSERT for the wrong org is
// rejected by the WITH CHECK policy. Skipped when DATABASE_URL_TEST is unset.
const maybe = process.env.DATABASE_URL_TEST ? describe : describe.skip;

// Fixed, namespaced ids so the seed/teardown is deterministic and can't collide
// with real data.
const ORG_A = '00000000-0000-0000-0000-00000000a000';
const ORG_B = '00000000-0000-0000-0000-00000000b000';
const CAMP_A = '00000000-0000-0000-0000-00000000a001';
const CAMP_B = '00000000-0000-0000-0000-00000000b001';
const CONTACT_A = '00000000-0000-0000-0000-00000000a002';
const CONTACT_B = '00000000-0000-0000-0000-00000000b002';

// Admin connection (server owner) bypasses RLS, so it can seed both orgs and
// tear them down regardless of policy. The app paths under test use app_user.
function adminClient(): Client {
  const url = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL_TEST;
  return new Client({
    connectionString: url,
    ssl:
      process.env.PGSSL === 'disable' && process.env.NODE_ENV !== 'production'
        ? false
        : { rejectUnauthorized: true },
  });
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL_TEST) return;
  // The db client reads server env at import time; point it at the test DB.
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;

  const c = adminClient();
  await c.connect();
  try {
    // Seed two isolated orgs, each with a campaign + a contact, via the owner
    // (RLS-exempt) so the fixture itself doesn't depend on the policy under test.
    await c.query(
      `insert into public.organizations (id, name, created_at, settings)
       values ($1,'Org A',now(),'{}'::jsonb), ($2,'Org B',now(),'{}'::jsonb)
       on conflict (id) do nothing`,
      [ORG_A, ORG_B],
    );
    await c.query(
      `insert into public.campaigns (id, org_id, name, created_at, updated_at)
       values ($1,$2,'Camp A',now(),now()), ($3,$4,'Camp B',now(),now())
       on conflict (id) do nothing`,
      [CAMP_A, ORG_A, CAMP_B, ORG_B],
    );
    await c.query(
      `insert into public.contacts (id, org_id, campaign_id, email, status, created_at, updated_at, metadata)
       values ($1,$2,$3,'a@example.com','none',now(),now(),'{}'::jsonb),
              ($4,$5,$6,'b@example.com','none',now(),now(),'{}'::jsonb)
       on conflict (id) do nothing`,
      [CONTACT_A, ORG_A, CAMP_A, CONTACT_B, ORG_B, CAMP_B],
    );
  } finally {
    await c.end();
  }
});

afterAll(async () => {
  if (!process.env.DATABASE_URL_TEST) return;
  const c = adminClient();
  await c.connect();
  try {
    await c.query('delete from public.contacts where id = any($1::uuid[])', [
      [CONTACT_A, CONTACT_B],
    ]);
    await c.query('delete from public.campaigns where id = any($1::uuid[])', [
      [CAMP_A, CAMP_B],
    ]);
    await c.query('delete from public.organizations where id = any($1::uuid[])', [
      [ORG_A, ORG_B],
    ]);
  } finally {
    await c.end();
  }
});

maybe('RLS isolation', () => {
  it('org A can read its own contact', async () => {
    const { withRls } = await import('@/lib/db/rls');
    const { contacts } = await import('@/lib/db/schema');
    const rows = await withRls({ userId: null, orgId: ORG_A }, (tx) =>
      tx.select().from(contacts).where(eq(contacts.id, CONTACT_A)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.orgId).toBe(ORG_A);
  });

  it('org A cannot read org B rows', async () => {
    const { withRls } = await import('@/lib/db/rls');
    const { contacts } = await import('@/lib/db/schema');
    // Read ALL contacts visible to org A; org B's row must be filtered out by RLS.
    const rowsForA = await withRls({ userId: null, orgId: ORG_A }, (tx) =>
      tx.select().from(contacts),
    );
    expect(rowsForA.find((row) => row.id === CONTACT_B)).toBeUndefined();
    expect(rowsForA.every((row) => row.orgId === ORG_A)).toBe(true);

    // And the symmetric direction: org B cannot see org A's row.
    const rowsForB = await withRls({ userId: null, orgId: ORG_B }, (tx) =>
      tx.select().from(contacts),
    );
    expect(rowsForB.find((row) => row.id === CONTACT_A)).toBeUndefined();
  });

  it('rejects an INSERT for a different org (WITH CHECK)', async () => {
    const { withServiceRls } = await import('@/lib/db/rls-service');
    const { contacts } = await import('@/lib/db/schema');
    // Acting as org A, try to insert a contact tagged org B → RLS WITH CHECK
    // must reject it. The cross-org campaign FK would also fail; either way the
    // write must NOT succeed.
    await expect(
      withServiceRls(ORG_A, (tx) =>
        tx.insert(contacts).values({
          orgId: ORG_B,
          campaignId: CAMP_B,
          status: 'none',
          metadata: {},
        }),
      ),
    ).rejects.toThrow();
  });
});
