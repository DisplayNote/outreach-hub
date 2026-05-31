import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentOrgId } from '@/lib/supabase/org';
import SuppressionAdmin, { type SuppressionRow } from '@/components/suppression-admin';

export const dynamic = 'force-dynamic';

/**
 * Suppressions admin (PHASE_5_SPEC §10) — the do-not-send list. Reply/bounce
 * scanning adds rows automatically; here a rep can add a manual suppression or
 * remove one (the "un-skip" path).
 */
export default async function SuppressionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const orgId = await getCurrentOrgId();
  const { data, error } = await supabase
    .from('suppressions')
    .select('id, email, reason, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  // Surface a load failure instead of rendering an empty list — a silent empty
  // suppression list reads as "nobody is suppressed" and would let an operator
  // re-enable sending to addresses that are actually still suppressed.
  if (error) throw new Error(`SuppressionsPage: failed to load suppressions: ${error.message}`);

  const rows: SuppressionRow[] = (data ?? []).map((r) => ({
    id: r.id as string,
    email: r.email as string,
    reason: r.reason as string,
    createdAt: r.created_at as string,
  }));

  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ marginBottom: '0.25rem' }}>Suppressions</h1>
      <p style={{ marginTop: 0, color: '#666' }}>
        Addresses that will never be emailed (across all campaigns). Replies and bounces add
        these automatically; remove one to re-enable sending.
      </p>
      <SuppressionAdmin rows={rows} />
    </main>
  );
}
