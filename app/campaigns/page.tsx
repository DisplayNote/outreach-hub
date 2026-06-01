import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { listCampaigns } from '@/lib/supabase/queries';
import { Card, EmptyState, Icon } from '@/components/ui';

// Auth state + the campaign list change per request; never prerender (ADR 004).
export const dynamic = 'force-dynamic';

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
    <div className="content__inner">
      <div className="page-head">
        <div>
          <div className="page-head__title">Campaigns</div>
          <div className="page-head__sub">Your organisation&rsquo;s outreach campaigns.</div>
        </div>
        <div className="page-actions">
          <Link href="/campaigns/new" className="btn btn--primary btn--md">
            <Icon name="plus" size={16} />
            <span>New campaign</span>
          </Link>
        </div>
      </div>

      <Card title="All campaigns" bodyStyle={{ padding: 0 }}>
        {campaigns.length === 0 ? (
          <EmptyState
            icon="campaign"
            title="No campaigns yet"
            desc="Create your first campaign to get started."
            action={
              <Link href="/campaigns/new" className="btn btn--primary btn--md">
                <Icon name="plus" size={16} />
                <span>New campaign</span>
              </Link>
            }
          />
        ) : (
          <div className="tbl-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Sequence</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.id}>
                    <td>
                      <Link href={`/campaigns/${campaign.id}/edit`} className="medb">
                        {campaign.name}
                      </Link>
                    </td>
                    <td className="sm">
                      {campaign.sequence ?? <span className="tert">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
