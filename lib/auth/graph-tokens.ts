import { sql } from 'drizzle-orm';
import { withRls, type RlsContext } from '@/lib/db/rls';

/**
 * Server-only storage for a user's delegated Microsoft Graph tokens. They live
 * in `public.user_graph_tokens` (RLS-scoped to the owning user) and are NEVER
 * projected onto the Auth.js Session or returned to the browser. Written at
 * login by the jwt callback; read server-side by lib/graph/token.ts.
 *
 * INTERIM (Phase 4 adds refresh): we store the refresh token + expiry here so
 * Phase 4 can refresh on expiry; for now an expired access token reads back as
 * null and the caller surfaces the re-auth prompt.
 */
export async function storeGraphTokens(
  ctx: RlsContext,
  tokens: { accessToken?: string | null; refreshToken?: string | null; expiresAt?: number | null },
): Promise<void> {
  if (!ctx.userId) return;
  const expiresAtIso = tokens.expiresAt ? new Date(tokens.expiresAt * 1000).toISOString() : null;
  await withRls(ctx, async (tx) => {
    await tx.execute(sql`
      insert into public.user_graph_tokens (user_id, access_token, refresh_token, expires_at, updated_at)
      values (${ctx.userId}, ${tokens.accessToken ?? null}, ${tokens.refreshToken ?? null}, ${expiresAtIso}, now())
      on conflict (user_id) do update set
        access_token  = excluded.access_token,
        -- keep the prior refresh token when a refresh response omits it
        refresh_token = coalesce(excluded.refresh_token, public.user_graph_tokens.refresh_token),
        expires_at    = excluded.expires_at,
        updated_at    = now()
    `);
  });
}

/** The user's current delegated access token, or null if absent/expired. */
export async function readGraphAccessToken(ctx: RlsContext): Promise<string | null> {
  if (!ctx.userId) return null;
  return withRls(ctx, async (tx) => {
    const result = await tx.execute(
      sql`select access_token, expires_at from public.user_graph_tokens where user_id = ${ctx.userId}`,
    );
    const row = result.rows[0] as { access_token: string | null; expires_at: string | null } | undefined;
    if (!row?.access_token) return null;
    // Expired → treat as absent so the caller prompts re-auth (Phase 4 refreshes).
    if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) return null;
    return row.access_token;
  });
}
