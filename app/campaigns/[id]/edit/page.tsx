import { notFound, redirect } from 'next/navigation';
import CampaignForm from '@/components/campaign-form';
import { updateCampaign } from '@/lib/actions/campaigns';
import type { UpdateCampaignInput } from '@/lib/actions/campaigns';
import { createClient } from '@/lib/supabase/server';
import { listCampaigns } from '@/lib/supabase/queries';
import { Card } from '@/components/ui';

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
    <div className="content__inner">
      <div className="page-head">
        <div>
          <div className="page-head__title">Edit campaign</div>
          <div className="page-head__sub">Update this campaign&rsquo;s details.</div>
        </div>
      </div>
      <Card>
        <CampaignForm
          action={action}
          campaign={campaign}
          submitLabel="Save changes"
          cancelHref="/campaigns"
        />
      </Card>
    </div>
  );
}
