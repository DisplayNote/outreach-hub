import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { listCampaigns } from '@/lib/supabase/queries';

// Auth state + the campaign list change per request; never prerender (ADR 004).
export const dynamic = 'force-dynamic';

// --- Inline styles (Tailwind is not wired yet; mirror app/contacts/page.tsx) --

const cellStyle: React.CSSProperties = {
  padding: '0.625rem 0.75rem',
  borderBottom: '1px solid #eee',
  textAlign: 'left',
  verticalAlign: 'top',
};

const headStyle: React.CSSProperties = {
  ...cellStyle,
  borderBottom: '2px solid #ddd',
  fontWeight: 600,
  color: '#555',
  fontSize: '0.8125rem',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};

const newCampaignLinkStyle: React.CSSProperties = {
  padding: '0.45rem 0.9rem',
  background: '#111',
  color: '#fff',
  textDecoration: 'none',
  borderRadius: 6,
  fontSize: '0.9rem',
  fontWeight: 500,
  whiteSpace: 'nowrap',
};

const rowLinkStyle: React.CSSProperties = {
  textDecoration: 'none',
  color: '#111',
  fontWeight: 500,
};

// --- Page --------------------------------------------------------------------

export default async function CampaignsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const campaigns = await listCampaigns();

  return (
    <main
      style={{
        padding: '2rem',
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 960,
        margin: '0 auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '1rem',
        }}
      >
        <div>
          <h1 style={{ marginBottom: '0.25rem' }}>Campaigns</h1>
          <p style={{ marginTop: 0, color: '#666' }}>
            Your organisation&rsquo;s outreach campaigns.
          </p>
        </div>
        <Link href="/campaigns/new" style={newCampaignLinkStyle}>
          New campaign
        </Link>
      </div>

      {campaigns.length === 0 ? (
        <div
          style={{
            marginTop: '2rem',
            padding: '2rem',
            textAlign: 'center',
            color: '#666',
            background: '#fafafa',
            border: '1px solid #eee',
            borderRadius: 6,
          }}
        >
          <p style={{ margin: 0, fontSize: '1.05rem' }}>No campaigns yet.</p>
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
            <Link href="/campaigns/new">Create your first campaign</Link> to get started.
          </p>
        </div>
      ) : (
        <table
          style={{
            marginTop: '1.5rem',
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '0.9375rem',
          }}
        >
          <thead>
            <tr>
              <th style={headStyle} scope="col">
                Name
              </th>
              <th style={headStyle} scope="col">
                Sequence
              </th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((campaign) => (
              <tr key={campaign.id}>
                <td style={cellStyle}>
                  <Link href={`/campaigns/${campaign.id}/edit`} style={rowLinkStyle}>
                    {campaign.name}
                  </Link>
                </td>
                <td style={cellStyle}>{campaign.sequence ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
