import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getPipelineSummary, listCampaigns } from '@/lib/supabase/queries';
import type { ContactStatus } from '@/lib/types/domain';

// Auth state + live counts change per request; never prerender (ADR 004).
export const dynamic = 'force-dynamic';

/** Human-friendly labels for each pipeline status, in schema order. */
const STATUS_LABELS: Record<ContactStatus, string> = {
  none: 'No status',
  amber: 'Amber',
  red: 'Red',
  green: 'Green',
  meeting: 'Meeting',
  notinterested: 'Not interested',
  bounced: 'Bounced',
};

/** A small swatch colour per status so the funnel reads at a glance. */
const STATUS_COLORS: Record<ContactStatus, string> = {
  none: '#9ca3af',
  amber: '#f59e0b',
  red: '#ef4444',
  green: '#22c55e',
  meeting: '#3b82f6',
  notinterested: '#6b7280',
  bounced: '#78716c',
};

export default async function PipelinePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const [summary, campaigns] = await Promise.all([getPipelineSummary(), listCampaigns()]);

  const total = summary.reduce((sum, bucket) => sum + bucket.count, 0);

  return (
    <main
      style={{
        padding: '2rem',
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 720,
        margin: '0 auto',
      }}
    >
      <h1 style={{ marginBottom: '0.25rem' }}>Pipeline</h1>
      <p style={{ color: '#666', marginTop: 0 }}>
        Read-only funnel of contacts by status for your organisation.
      </p>

      {total === 0 ? (
        <section
          style={{
            marginTop: '2rem',
            padding: '2rem',
            textAlign: 'center',
            border: '1px dashed #ccc',
            borderRadius: 8,
            color: '#666',
          }}
        >
          <p style={{ margin: 0 }}>No contacts yet.</p>
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
            Once contacts are imported, their pipeline breakdown will appear here.
          </p>
        </section>
      ) : (
        <>
          <p style={{ marginTop: '1.5rem', fontWeight: 600 }}>
            {total} contact{total === 1 ? '' : 's'} total
          </p>

          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: '0.5rem 0 0',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}
          >
            {summary.map(({ status, count }) => (
              <li
                key={status}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.6rem 0.9rem',
                  border: '1px solid #e5e7eb',
                  borderRadius: 6,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: STATUS_COLORS[status],
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1 }}>{STATUS_LABELS[status]}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{count}</span>
              </li>
            ))}
          </ul>

          <section style={{ marginTop: '2.5rem' }}>
            <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Campaigns</h2>
            {campaigns.length === 0 ? (
              <p style={{ color: '#666', margin: 0 }}>No campaigns yet.</p>
            ) : (
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.4rem',
                }}
              >
                {campaigns.map((campaign) => (
                  <li
                    key={campaign.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '0.75rem',
                      padding: '0.5rem 0.9rem',
                      border: '1px solid #e5e7eb',
                      borderRadius: 6,
                    }}
                  >
                    <span>{campaign.name}</span>
                    {campaign.sequence ? (
                      <span style={{ color: '#666', fontSize: '0.9rem' }}>{campaign.sequence}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
