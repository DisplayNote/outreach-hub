import { redirect } from 'next/navigation';
import CampaignForm from '@/components/campaign-form';
import { createCampaign } from '@/lib/actions/campaigns';
import type { CreateCampaignInput } from '@/lib/actions/campaigns';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui';

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
    <div className="content__inner">
      <div className="page-head">
        <div>
          <div className="page-head__title">New campaign</div>
          <div className="page-head__sub">Create a campaign to group your outreach contacts.</div>
        </div>
      </div>
      <Card>
        <CampaignForm action={action} submitLabel="Create campaign" cancelHref="/campaigns" />
      </Card>
    </div>
  );
}
