import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getActivityFeed } from '@/lib/supabase/queries';
import type { TouchpointChannel } from '@/lib/types/domain';
import { Badge, Card, EmptyState } from '@/components/ui';

// Auth state + activity data change per request; never prerender.
export const dynamic = 'force-dynamic';

// --- Display helpers ---------------------------------------------------------

/** Human-readable label for each touchpoint channel. */
const CHANNEL_LABELS: Record<TouchpointChannel, string> = {
  email: 'Email',
  phone: 'Phone',
  linkedin: 'LinkedIn',
  other: 'Other',
};

/** Format an ISO timestamp (the touchpoint's `occurred_at`) for display. */
function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// --- Page --------------------------------------------------------------------

export default async function ActivityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const items = await getActivityFeed();

  return (
    <div className="content__inner">
      <div className="page-head">
        <div>
          <div className="page-head__title">Activity</div>
          <div className="page-head__sub">
            Recent touchpoints across all contacts, newest first.
          </div>
        </div>
      </div>

      <Card title="Recent activity" bodyStyle={{ padding: 0 }}>
        {items.length === 0 ? (
          <EmptyState
            icon="inbox"
            title="No activity yet"
            desc="Touchpoints will appear here as you log them against your contacts."
          />
        ) : (
          <div className="tbl-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Channel</th>
                  <th scope="col">Contact</th>
                  <th scope="col">Note</th>
                  <th scope="col">When</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Badge tone="neutral">{CHANNEL_LABELS[item.channel]}</Badge>
                    </td>
                    <td>
                      <Link href={`/contacts/${item.contactId}`} className="medb">
                        {item.contactName}
                      </Link>
                      {item.contactCompany ? (
                        <div className="cap tert">{item.contactCompany}</div>
                      ) : null}
                    </td>
                    <td className="sm muted">
                      {item.note ? item.note : <span className="tert">No note</span>}
                    </td>
                    <td className="sm muted" style={{ whiteSpace: 'nowrap' }}>
                      {formatTimestamp(item.occurredAt)}
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
