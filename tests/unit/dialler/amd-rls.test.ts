import { describe, beforeAll, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';

// Integration test (gated on DATABASE_URL_TEST) for the AMD/dialler RLS path —
// the cross-phase regression the final review caught: on Azure the app connects
// as the RLS-subject app_user, so the inbound Telnyx webhook must (1) discover
// the attempt ORG-BLIND via the find_call_attempt SECURITY DEFINER lookup, then
// (2) write it under the resolved org. Without the definer + write policies,
// every inbound call event is silently dropped. This locks both in.
const maybe = process.env.DATABASE_URL_TEST ? describe : describe.skip;

// Patch DATABASE_URL before lib/db/client creates its Pool (lazy dynamic imports
// below ensure the module loads only after this assignment).
beforeAll(() => {
  if (process.env.DATABASE_URL_TEST) {
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  }
});

maybe('dialler AMD RLS (webhook discovery + writes)', () => {
  it('discovers an attempt org-blind via the definer, writes org-scoped, and denies the bare org-blind read', async () => {
    const { db } = await import('@/lib/db/client');
    const { withServiceRls } = await import('@/lib/db/rls-service');

    const cc = `cc-rls-test-${Date.now()}`;
    const email = `amd-rls-${Date.now()}@test.local`;

    // Provision an org+user (SECURITY DEFINER; bypasses RLS).
    const prov = await db.execute(sql`select user_id, org_id from public.provision_user(${email}, 'AMD')`);
    const { user_id: userId, org_id: orgId } = prov.rows[0] as { user_id: string; org_id: string };

    // Seed the call chain as app_user UNDER the org GUC — exercises the new
    // INSERT policies (these would throw if the policies were missing).
    await withServiceRls(orgId, async (tx) => {
      const camp = await tx.execute(sql`insert into campaigns (org_id, name) values (${orgId}, 'c') returning id`);
      const campId = (camp.rows[0] as { id: string }).id;
      const con = await tx.execute(
        sql`insert into contacts (org_id, campaign_id, first_name) values (${orgId}, ${campId}, 'x') returning id`,
      );
      const conId = (con.rows[0] as { id: string }).id;
      const run = await tx.execute(
        sql`insert into call_runs (org_id, created_by, status) values (${orgId}, ${userId}, 'active') returning id`,
      );
      const runId = (run.rows[0] as { id: string }).id;
      await tx.execute(
        sql`insert into call_attempts (org_id, run_id, contact_id, to_number, provider, state, call_control_id)
            values (${orgId}, ${runId}, ${conId}, '+44', 'telnyx', 'queued', ${cc})`,
      );
    });

    // Org-blind bare SELECT (no GUC → current_org_id() is NULL) is denied by RLS.
    const bare = await db.execute(sql`select count(*)::int as n from call_attempts where call_control_id = ${cc}`);
    expect((bare.rows[0] as { n: number }).n).toBe(0);

    // The webhook discovery path: find_call_attempt finds it org-blind, via the
    // definer bypass, and returns its org.
    const found = await db.execute(sql`select org_id from public.find_call_attempt(${cc}, null)`);
    expect(found.rows).toHaveLength(1);
    expect((found.rows[0] as { org_id: string }).org_id).toBe(orgId);

    // The org-scoped UPDATE (under the resolved org) succeeds — the new write policy.
    const updated = await withServiceRls(orgId, (tx) =>
      tx.execute(sql`update call_attempts set state = 'ringing' where call_control_id = ${cc} returning id`),
    );
    expect(updated.rows).toHaveLength(1);
  });
});
