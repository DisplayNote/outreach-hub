import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import {
  getActivityFeed,
  getPipelineSummary,
  getReportMetrics,
  getTodayContacts,
} from '@/lib/db/queries';
import type { Contact, TouchpointChannel } from '@/lib/types/domain';
import { Avatar, Badge, Card, EmptyState, Icon, Pill, StatCard } from '@/components/ui';
import { STATUS_PILLS } from '@/lib/ui/status';
import { contactInitials } from '@/lib/ui/initials';

// Auth state + all dashboard data change per request; never prerender (ADR 004).
export const dynamic = 'force-dynamic';

// --- Display helpers ---------------------------------------------------------

/** Full name from first/last, falling back to email or a placeholder. */
function contactName(contact: Contact): string {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
  return name || contact.email || 'Unnamed contact';
}

/** `YYYY-MM-DD` today (UTC), matching how `follow_up` (a SQL date) is stored. */
function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Format an ISO `YYYY-MM-DD` follow-up date for display. */
function formatDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Compact relative time ("just now", "5m ago", "3h ago", "2d ago"). */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const CHANNEL_ICONS: Record<TouchpointChannel, string> = {
  email: 'mail',
  phone: 'phone',
  linkedin: 'contacts',
  other: 'info',
};
const CHANNEL_LABELS: Record<TouchpointChannel, string> = {
  email: 'Email',
  phone: 'Call',
  linkedin: 'LinkedIn',
  other: 'Touchpoint',
};

// --- Page --------------------------------------------------------------------

export default async function Home() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  // Fetch every panel's data concurrently — one round-trip latency, not four.
  const [metrics, pipeline, due, activity] = await Promise.all([
    getReportMetrics(),
    getPipelineSummary(),
    getTodayContacts(),
    getActivityFeed(8),
  ]);

  const greeting = (session.email?.split('@')[0] ?? 'there').replace(/[._-]+/g, ' ');
  const today = todayDateString();

  // Pipeline bars: show populated buckets, widest-first, scaled to the biggest.
  const buckets = pipeline.filter((b) => b.count > 0).sort((a, b) => b.count - a.count);
  const maxBucket = buckets.reduce((m, b) => Math.max(m, b.count), 0);

  return (
    <div className="content__inner">
      <div className="page-head">
        <div>
          <div className="page-head__title" style={{ textTransform: 'capitalize' }}>
            Welcome back, {greeting}
          </div>
          <div className="page-head__sub">Here&rsquo;s your outreach at a glance.</div>
        </div>
        <div className="page-actions">
          <Link href="/dialler" className="btn btn--secondary btn--md">
            <Icon name="phone" size={16} />
            <span>Start calling</span>
          </Link>
          <Link href="/queue" className="btn btn--primary btn--md">
            <Icon name="zap" size={16} />
            <span>Run sender</span>
          </Link>
        </div>
      </div>

      {/* KPI row */}
      <div className="stat-grid" style={{ marginBottom: 'var(--space-6)' }}>
        <StatCard icon="contacts" label="Contacts" value={metrics.totalContacts} />
        <StatCard icon="calendar" label="Meetings booked" value={metrics.meetings} />
        <StatCard
          icon="zap"
          label="Due today"
          value={metrics.contactsDueToday}
          sub={metrics.contactsOverdue > 0 ? `${metrics.contactsOverdue} overdue` : 'All caught up'}
        />
        <StatCard
          icon="reply"
          label="Touchpoints · 7d"
          value={metrics.touchpointsLast7Days}
        />
      </div>

      {/* Two-column: follow-ups + pipeline */}
      <div className="detail-grid" style={{ marginBottom: 'var(--space-6)' }}>
        <Card
          title="Follow-ups due today"
          bodyStyle={{ padding: 0 }}
          action={
            <Link href="/today" className="btn btn--ghost btn--sm">
              View all
            </Link>
          }
        >
          {due.length === 0 ? (
            <EmptyState
              icon="checkCircle"
              title="Nothing due today"
              desc="You're all caught up on follow-ups."
            />
          ) : (
            <div className="tbl-wrap" style={{ border: 'none', borderRadius: 0 }}>
              <table className="tbl">
                <tbody>
                  {due.slice(0, 6).map((contact) => {
                    const overdue = contact.followUp !== null && contact.followUp < today;
                    return (
                      <tr key={contact.id}>
                        <td>
                          <Link
                            href={`/contacts/${contact.id}`}
                            className="row gap-5 center"
                          >
                            <Avatar initials={contactInitials(contact)} size="sm" />
                            <div style={{ minWidth: 0 }}>
                              <div className="medb" style={{ whiteSpace: 'nowrap' }}>
                                {contactName(contact)}
                              </div>
                              {contact.company ? (
                                <div className="cap tert" style={{ whiteSpace: 'nowrap' }}>
                                  {contact.company}
                                </div>
                              ) : null}
                            </div>
                          </Link>
                        </td>
                        <td>
                          <Pill spec={STATUS_PILLS[contact.status]} />
                        </td>
                        <td className="sm" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {contact.followUp ? (
                            overdue ? (
                              <Badge tone="danger">Overdue</Badge>
                            ) : (
                              formatDate(contact.followUp)
                            )
                          ) : (
                            <span className="tert">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title="Pipeline"
          action={
            <Link href="/pipeline" className="btn btn--ghost btn--sm">
              View all
            </Link>
          }
        >
          {buckets.length === 0 ? (
            <EmptyState icon="pipeline" title="No contacts yet" desc="Import or add contacts to build your pipeline." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              {buckets.map((bucket) => {
                const spec = STATUS_PILLS[bucket.status];
                const width = maxBucket > 0 ? Math.round((bucket.count / maxBucket) * 100) : 0;
                return (
                  <div key={bucket.status}>
                    <div
                      className="row center between"
                      style={{ marginBottom: 'var(--space-3)' }}
                    >
                      <Pill spec={spec} />
                      <span className="semib tnum sm">{bucket.count}</span>
                    </div>
                    <div className="progress">
                      <div
                        className="progress__bar"
                        style={{ width: `${width}%`, background: spec.dot }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Recent activity */}
      <Card
        title="Recent activity"
        bodyStyle={{ padding: 0 }}
        action={
          <Link href="/activity" className="btn btn--ghost btn--sm">
            View all
          </Link>
        }
      >
        {activity.length === 0 ? (
          <EmptyState
            icon="reply"
            title="No activity yet"
            desc="Logged calls and emails will show up here."
          />
        ) : (
          <div className="tbl-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table className="tbl">
              <tbody>
                {activity.map((item) => (
                  <tr key={item.id}>
                    <td style={{ width: 1 }}>
                      <span
                        className="avatar avatar--sm"
                        aria-hidden="true"
                        style={{ background: 'var(--bg-muted)', color: 'var(--text-tertiary)' }}
                      >
                        <Icon name={CHANNEL_ICONS[item.channel]} size={13} />
                      </span>
                    </td>
                    <td>
                      <Link href={`/contacts/${item.contactId}`} className="medb">
                        {item.contactName}
                      </Link>
                      {item.contactCompany ? (
                        <span className="sm tert"> · {item.contactCompany}</span>
                      ) : null}
                    </td>
                    <td className="sm muted">{CHANNEL_LABELS[item.channel]}</td>
                    <td className="sm tert" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {relativeTime(item.occurredAt)}
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
