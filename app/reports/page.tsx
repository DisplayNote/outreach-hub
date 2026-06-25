import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { getReportMetrics } from '@/lib/db/queries';
import { Card, EmptyState, StatCard } from '@/components/ui';
import { STATUS_PILLS } from '@/lib/ui/status';

// Auth state + live metrics change per request; never prerender (ADR 004).
export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const metrics = await getReportMetrics();

  const {
    totalContacts,
    byStatus,
    meetings,
    bounced,
    touchpointsLast7Days,
    contactsDueToday,
    contactsOverdue,
  } = metrics;

  // The funnel bars are scaled relative to the largest bucket so the widths read
  // proportionally even when no single status dominates.
  const maxBucket = byStatus.reduce((max, bucket) => Math.max(max, bucket.count), 0);

  return (
    <div className="content__inner">
      <div className="page-head">
        <div>
          <div className="page-head__title">Reports</div>
          <div className="page-head__sub">
            Read-only overview of your organisation&rsquo;s outreach activity.
          </div>
        </div>
      </div>

      {totalContacts === 0 ? (
        <Card>
          <EmptyState
            icon="reports"
            title="No data to report yet"
            desc="Once contacts are imported and you log touchpoints, your metrics will appear here."
          />
        </Card>
      ) : (
        <>
          <div className="stat-grid" style={{ marginBottom: 'var(--space-6)' }}>
            <StatCard icon="contacts" label="Total contacts" value={totalContacts.toLocaleString()} />
            <StatCard icon="calendar" label="Meetings booked" value={meetings.toLocaleString()} />
            <StatCard icon="zap" label="Touchpoints (7 days)" value={touchpointsLast7Days.toLocaleString()} />
            <StatCard icon="suppress" label="Bounced" value={bounced.toLocaleString()} />
          </div>

          <div className="stat-grid" style={{ marginBottom: 'var(--space-6)' }}>
            <StatCard icon="calendar" label="Due today" value={contactsDueToday.toLocaleString()} />
            <StatCard icon="alert" label="Overdue" value={contactsOverdue.toLocaleString()} />
          </div>

          <Card title="Funnel by status">
            <div className="col gap-5">
              {byStatus.map(({ status, count }) => {
                const spec = STATUS_PILLS[status];
                const widthPct = maxBucket === 0 ? 0 : Math.round((count / maxBucket) * 100);
                const sharePct =
                  totalContacts === 0 ? 0 : Math.round((count / totalContacts) * 100);

                return (
                  <div key={status} className="bar-track">
                    <span className="bar-track__label row gap-3 center">
                      <span
                        aria-hidden="true"
                        className="pill__dot"
                        style={{ background: spec.dot }}
                      />
                      {spec.label}
                    </span>
                    <div className="bar-track__bar">
                      <div
                        className="bar-track__fill"
                        style={{ width: `${widthPct}%`, background: spec.dot }}
                      >
                        {widthPct >= 20 ? `${sharePct}%` : null}
                      </div>
                    </div>
                    <span className="bar-track__val">{count.toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
