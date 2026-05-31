import { notFound, redirect } from 'next/navigation';
import CampaignForm from '@/components/campaign-form';
import { updateCampaign } from '@/lib/actions/campaigns';
import type { UpdateCampaignInput } from '@/lib/actions/campaigns';
import { createClient } from '@/lib/supabase/server';
import { listCampaigns } from '@/lib/supabase/queries';

// Auth state + campaign data change per request; never prerender (ADR 004).
export const dynamic = 'force-dynamic';

// --- FormData parsing ---------------------------------------------------------

/** Trim a form field; collapse empty/missing to null so the column stays clean. */
function text(formData: FormData, key: string): string | null {
  const raw = formData.get(key);
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

const mainStyle: React.CSSProperties = {
  padding: '2rem',
  fontFamily: 'system-ui, sans-serif',
  maxWidth: 720,
  margin: '0 auto',
};

export default async function EditCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // No single-row campaign query exists; resolve from the RLS-scoped list. A
  // missing id (unknown or cross-org) yields a 404 at the page level.
  const campaigns = await listCampaigns();
  const campaign = campaigns.find((c) => c.id === id);

  if (!campaign) {
    notFound();
  }

  // Server Action bound to the form. Parses the submitted FormData into the
  // typed UpdateCampaignInput, updates by id (RLS scopes to the org), then
  // redirects back to the campaigns list.
  async function action(formData: FormData): Promise<void> {
    'use server';

    const input: UpdateCampaignInput = {
      name: String(formData.get('name') ?? '').trim(),
      sequence: text(formData, 'sequence'),
    };

    await updateCampaign(id, input);
    redirect('/campaigns');
  }

  return (
    <main style={mainStyle}>
      <h1 style={{ marginBottom: '0.25rem' }}>Edit campaign</h1>
      <p style={{ marginTop: 0, marginBottom: '1.5rem', color: '#666' }}>
        Update this campaign&rsquo;s details.
      </p>
      <CampaignForm
        action={action}
        campaign={campaign}
        submitLabel="Save changes"
        cancelHref="/campaigns"
      />
    </main>
  );
}
