import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getReportMetrics } from '@/lib/supabase/queries';
import type { ContactStatus } from '@/lib/types/domain';

// Auth state + live metrics change per request; never prerender (ADR 004).
export const dynamic = 'force-dynamic';

/** Human-friendly labels for each pipeline status, in schema order. */
const STATUS_LABELS: Record<ContactStatus, string> = {
  none: 'No status',
  amber: 'Amber',
  red: 'Red',
  green: 'Green',
  meeting: 'Meeting',
  notinterested: 'Not interested',
  bounced: 'Bounced',
};

/** A small swatch colour per status so the funnel reads at a glance (mirrors /pipeline). */
const STATUS_COLORS: Record<ContactStatus, string> = {
  none: '#9ca3af',
  amber: '#f59e0b',
  red: '#ef4444',
  green: '#22c55e',
  meeting: '#3b82f6',
  notinterested: '#6b7280',
  bounced: '#78716c',
};

// --- Inline styles (Tailwind is not wired yet; mirror app/page.tsx) ----------

const cardStyle: React.CSSProperties = {
  flex: '1 1 8rem',
  minWidth: '8rem',
  padding: '1rem 1.1rem',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  background: '#fff',
};

const cardLabelStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.75rem',
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};

const cardValueStyle: React.CSSProperties = {
  margin: '0.35rem 0 0',
  fontSize: '1.75rem',
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
  color: '#111',
};

interface HeadlineCardProps {
  label: string;
  value: number;
  accent?: string;
}

/** One labelled headline number, rendered as a simple card. */
function HeadlineCard({ label, value, accent }: HeadlineCardProps) {
  return (
    <div style={cardStyle}>
      <p style={cardLabelStyle}>{label}</p>
      <p style={accent ? { ...cardValueStyle, color: accent } : cardValueStyle}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}

export default async function ReportsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
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
    <main
      style={{
        padding: '2rem',
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 720,
        margin: '0 auto',
      }}
    >
      <h1 style={{ marginBottom: '0.25rem' }}>Reports</h1>
      <p style={{ color: '#666', marginTop: 0 }}>
        Read-only overview of your organisation&rsquo;s outreach activity.
      </p>

      {totalContacts === 0 ? (
        <section
          style={{
            marginTop: '2rem',
            padding: '2rem',
            textAlign: 'center',
            border: '1px dashed #ccc',
            borderRadius: 8,
            color: '#666',
          }}
        >
          <p style={{ margin: 0 }}>No data to report yet.</p>
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
            Once contacts are imported and you log touchpoints, your metrics will appear here.
          </p>
        </section>
      ) : (
        <>
          <section style={{ marginTop: '1.5rem' }}>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.75rem',
              }}
            >
              <HeadlineCard label="Total contacts" value={totalContacts} />
              <HeadlineCard label="Meetings booked" value={meetings} accent="#3b82f6" />
              <HeadlineCard label="Bounced" value={bounced} accent="#78716c" />
            </div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.75rem',
                marginTop: '0.75rem',
              }}
            >
              <HeadlineCard label="Touchpoints (last 7 days)" value={touchpointsLast7Days} />
              <HeadlineCard label="Due today" value={contactsDueToday} accent="#f59e0b" />
              {contactsOverdue > 0 ? (
                <HeadlineCard label="Overdue" value={contactsOverdue} accent="#b91c1c" />
              ) : (
                <HeadlineCard label="Overdue" value={contactsOverdue} />
              )}
            </div>
          </section>

          <section style={{ marginTop: '2.5rem' }}>
            <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Funnel by status</h2>
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: '0.5rem 0 0',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
              }}
            >
              {byStatus.map(({ status, count }) => {
                const widthPct = maxBucket === 0 ? 0 : Math.round((count / maxBucket) * 100);
                const sharePct =
                  totalContacts === 0 ? 0 : Math.round((count / totalContacts) * 100);

                return (
                  <li key={status}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: '0.5rem',
                        marginBottom: '0.25rem',
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          background: STATUS_COLORS[status],
                          flexShrink: 0,
                          alignSelf: 'center',
                        }}
                      />
                      <span style={{ flex: 1, fontSize: '0.9375rem' }}>
                        {STATUS_LABELS[status]}
                      </span>
                      <span
                        style={{
                          fontVariantNumeric: 'tabular-nums',
                          fontWeight: 600,
                          fontSize: '0.9375rem',
                        }}
                      >
                        {count.toLocaleString()}
                      </span>
                      <span
                        style={{
                          width: '3rem',
                          textAlign: 'right',
                          color: '#9ca3af',
                          fontSize: '0.8125rem',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {sharePct}%
                      </span>
                    </div>
                    <div
                      style={{
                        height: 8,
                        borderRadius: 4,
                        background: '#f3f4f6',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${widthPct}%`,
                          height: '100%',
                          background: STATUS_COLORS[status],
                          borderRadius: 4,
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
