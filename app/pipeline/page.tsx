import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { getPipelineSummary, listCampaigns } from '@/lib/db/queries';
import { Card, EmptyState, Pill, StatCard } from '@/components/ui';
import { STATUS_PILLS } from '@/lib/ui/status';

// Auth state + live counts change per request; never prerender (ADR 004).
export const dynamic = 'force-dynamic';

export default async function PipelinePage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const [summary, campaigns] = await Promise.all([getPipelineSummary(), listCampaigns()]);

  const total = summary.reduce((sum, bucket) => sum + bucket.count, 0);

  return (
    <div className="content__inner">
      <div className="page-head">
        <div>
          <div className="page-head__title">Pipeline</div>
          <div className="page-head__sub">
            Read-only funnel of contacts by status for your organisation.
          </div>
        </div>
      </div>

      <div className="stat-grid" style={{ marginBottom: 'var(--space-7)' }}>
        <StatCard
          icon="contacts"
          label="Total contacts"
          value={total.toLocaleString()}
          sub={total === 1 ? 'contact' : 'contacts'}
        />
        <StatCard icon="campaign" label="Campaigns" value={campaigns.length.toLocaleString()} />
      </div>

      <Card title="Funnel" bodyStyle={{ padding: 0 }}>
        {total === 0 ? (
          <EmptyState
            icon="pipeline"
            title="No contacts yet"
            desc="Once contacts are imported, their pipeline breakdown will appear here."
          />
        ) : (
          <div className="tbl-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">
                    Contacts
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.map(({ status, count }) => (
                  <tr key={status}>
                    <td>
                      <Pill spec={STATUS_PILLS[status]} />
                    </td>
                    <td className="num">{count.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div style={{ marginTop: 'var(--space-7)' }}>
        <Card title="Campaigns" bodyStyle={{ padding: 0 }}>
          {campaigns.length === 0 ? (
            <EmptyState
              icon="campaign"
              title="No campaigns yet"
              desc="Campaigns will appear here once they are created."
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
                      <td className="medb">{campaign.name}</td>
                      <td className="sm muted">{campaign.sequence ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
