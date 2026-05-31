import { redirect } from 'next/navigation';
import CampaignForm from '@/components/campaign-form';
import { createCampaign } from '@/lib/actions/campaigns';
import type { CreateCampaignInput } from '@/lib/actions/campaigns';
import { createClient } from '@/lib/supabase/server';

// Auth state changes per request; never prerender (ADR 004).
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

export default async function NewCampaignPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Server Action bound to the form. Parses the submitted FormData into the
  // typed CreateCampaignInput, inserts (org_id is set inside createCampaign),
  // then redirects to the campaigns list.
  async function action(formData: FormData): Promise<void> {
    'use server';

    const input: CreateCampaignInput = {
      name: String(formData.get('name') ?? '').trim(),
      sequence: text(formData, 'sequence'),
    };

    await createCampaign(input);
    redirect('/campaigns');
  }

  return (
    <main style={mainStyle}>
      <h1 style={{ marginBottom: '0.25rem' }}>New campaign</h1>
      <p style={{ marginTop: 0, marginBottom: '1.5rem', color: '#666' }}>
        Create a campaign to group your outreach contacts.
      </p>
      <CampaignForm action={action} submitLabel="Create campaign" cancelHref="/campaigns" />
    </main>
  );
}
