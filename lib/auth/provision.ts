import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';

/**
 * First-login provisioning: ensure the signing-in identity has an organization
 * and a `public.users` row, returning its id / org / role.
 *
 * This runs on the privileged first-login path BEFORE any session exists, so it
 * cannot go through `withRls` (there are no GUCs to set yet, and the RLS WITH
 * CHECK on organizations/users would reject the insert). Instead it delegates to
 * `public.provision_user`, a SECURITY DEFINER function owned by the migration
 * owner: it bypasses RLS and the auth.users grant restriction internally while
 * exposing only the fixed bootstrap operation. The function is idempotent — a
 * known email returns its existing row — so re-running it on every login is
 * safe and matches the legacy `handle_new_user` semantics verbatim.
 */
export interface ProvisionResult {
  userId: string;
  orgId: string;
  role: string;
}

export async function provisionUser(input: {
  email: string;
  name?: string;
}): Promise<ProvisionResult> {
  const email = input.email.trim();
  if (!email) {
    throw new Error('provisionUser: email is required');
  }
  const name = input.name?.trim() ?? null;

  const result = await db.execute(
    sql`select user_id, org_id, role from public.provision_user(${email}, ${name})`,
  );
  const row = result.rows[0] as
    | { user_id: string; org_id: string; role: string }
    | undefined;
  if (!row) {
    throw new Error(`provisionUser: provision_user returned no row for ${email}`);
  }
  return { userId: row.user_id, orgId: row.org_id, role: row.role };
}
