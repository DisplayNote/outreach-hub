import { redirect } from 'next/navigation';
import { desc } from 'drizzle-orm';
import { getSession, rlsCtxFromSession } from '@/lib/auth/session';
import { withRls } from '@/lib/db/rls';
import { suppressions } from '@/lib/db/schema';
import SuppressionAdmin, { type SuppressionRow } from '@/components/suppression-admin';

export const dynamic = 'force-dynamic';

/**
 * Suppressions admin (PHASE_5_SPEC §10) — the do-not-send list. Reply/bounce
 * scanning adds rows automatically; here a rep can add a manual suppression or
 * remove one (the "un-skip" path).
 */
export default async function SuppressionsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  // RLS scopes `suppressions` to the caller's org (no app-layer org filter).
  // A load failure throws (a silent empty list reads as "nobody is suppressed"
  // and would let an operator re-enable sending to still-suppressed addresses).
  const rows: SuppressionRow[] = await withRls(rlsCtxFromSession(session), async (tx) => {
    const data = await tx
      .select({
        id: suppressions.id,
        email: suppressions.email,
        reason: suppressions.reason,
        createdAt: suppressions.createdAt,
      })
      .from(suppressions)
      .orderBy(desc(suppressions.createdAt));
    return data.map((r) => ({
      id: r.id,
      email: r.email,
      reason: r.reason,
      createdAt: r.createdAt,
    }));
  });

  return (
    <div className="content__inner">
      <div className="page-head">
        <div>
          <div className="page-head__title">Suppressions</div>
          <div className="page-head__sub">
            Addresses that will never be emailed (across all campaigns). Replies and bounces add
            these automatically; remove one to re-enable sending.
          </div>
        </div>
      </div>
      <SuppressionAdmin rows={rows} />
    </div>
  );
}
