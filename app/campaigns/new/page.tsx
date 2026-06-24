import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import CampaignForm from '@/components/campaign-form';
import { createCampaign } from '@/lib/actions/campaigns';
import type { CreateCampaignInput } from '@/lib/actions/campaigns';
import { listSequences } from '@/lib/db/queries';
import { Card } from '@/components/ui';

// Auth state changes per request; never prerender (ADR 004).
export const dynamic = 'force-dynamic';

export default async function NewCampaignPage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const sequences = await listSequences();

  // Server Action bound to the form. Parses the submitted FormData into the
  // typed CreateCampaignInput, inserts (org_id is set inside createCampaign),
  // then redirects to the campaigns list. `sequenceId` is the raw <select>
  // value ('' for "no sequence"); createCampaign validates and resolves it.
  async function action(formData: FormData): Promise<void> {
    'use server';

    const input: CreateCampaignInput = {
      name: String(formData.get('name') ?? '').trim(),
      sequenceId: String(formData.get('sequenceId') ?? ''),
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
        <CampaignForm
          action={action}
          sequences={sequences}
          submitLabel="Create campaign"
          cancelHref="/campaigns"
        />
      </Card>
    </div>
  );
}
