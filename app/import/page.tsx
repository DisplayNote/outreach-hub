import { redirect } from 'next/navigation';
import ApolloImportForm from '@/components/apollo-import-form';
import { createClient } from '@/lib/supabase/server';
import { listCampaigns } from '@/lib/supabase/queries';

// Auth state + campaign list change per request; never prerender.
export const dynamic = 'force-dynamic';

const mainStyle: React.CSSProperties = {
  padding: '2rem',
  fontFamily: 'system-ui, sans-serif',
  maxWidth: 720,
  margin: '0 auto',
};

export default async function ImportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const campaigns = await listCampaigns();

  // Imported contacts must land in a campaign — guide the user to create one
  // first rather than rendering an import form that can never submit.
  if (campaigns.length === 0) {
    return (
      <main style={mainStyle}>
        <h1 style={{ marginBottom: '0.25rem' }}>Import contacts</h1>
        <div
          style={{
            marginTop: '1.5rem',
            padding: '2rem',
            textAlign: 'center',
            color: '#666',
            background: '#fafafa',
            border: '1px solid #eee',
            borderRadius: 6,
          }}
        >
          <p style={{ margin: 0, fontSize: '1.05rem' }}>No campaigns yet.</p>
          <p style={{ margin: '0.5rem 0 1.25rem', fontSize: '0.9rem' }}>
            Imported contacts are added to a campaign. Create a campaign first,
            then come back to import your Apollo CSV into it.
          </p>
          <a
            href="/campaigns/new"
            style={{
              padding: '0.55rem 1.25rem',
              background: '#111',
              color: '#fff',
              border: '1px solid #111',
              borderRadius: 4,
              fontSize: '0.9375rem',
              fontWeight: 600,
              textDecoration: 'none',
              display: 'inline-block',
            }}
          >
            Create a campaign
          </a>
        </div>
      </main>
    );
  }

  return (
    <main style={mainStyle}>
      <h1 style={{ marginBottom: '0.25rem' }}>Import contacts</h1>
      <p style={{ marginTop: 0, marginBottom: '1.5rem', color: '#666' }}>
        Import an Apollo (or generic) CSV export into one of your campaigns.
        Recognised columns map to contact fields; everything else is preserved
        as metadata.
      </p>
      <ApolloImportForm campaigns={campaigns} />
    </main>
  );
}
