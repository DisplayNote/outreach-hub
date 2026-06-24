import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import ApolloImportForm from '@/components/apollo-import-form';
import { listCampaigns } from '@/lib/db/queries';
import { Card, EmptyState } from '@/components/ui';

// Auth state + campaign list change per request; never prerender.
export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const campaigns = await listCampaigns();

  // Imported contacts must land in a campaign — guide the user to create one
  // first rather than rendering an import form that can never submit.
  if (campaigns.length === 0) {
    return (
      <div className="content__inner">
        <div className="page-head">
          <div>
            <div className="page-head__title">Import contacts</div>
            <div className="page-head__sub">Import an Apollo (or generic) CSV export into one of your campaigns.</div>
          </div>
        </div>
        <Card>
          <EmptyState
            icon="campaign"
            title="No campaigns yet"
            desc="Imported contacts are added to a campaign. Create a campaign first, then come back to import your Apollo CSV into it."
            action={
              <Link href="/campaigns/new" className="btn btn--primary btn--md">
                Create a campaign
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="content__inner">
      <div className="page-head">
        <div>
          <div className="page-head__title">Import contacts</div>
          <div className="page-head__sub">
            Import an Apollo (or generic) CSV export into one of your campaigns. Recognised columns
            map to contact fields; everything else is preserved as metadata.
          </div>
        </div>
      </div>
      <Card>
        <ApolloImportForm campaigns={campaigns} />
      </Card>
    </div>
  );
}
