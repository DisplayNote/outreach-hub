import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getActivityFeed } from '@/lib/supabase/queries';
import type { TouchpointChannel } from '@/lib/types/domain';

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

// --- Inline styles (Tailwind is not wired yet; mirror app/today/page.tsx) ----

const cellStyle: React.CSSProperties = {
  padding: '0.625rem 0.75rem',
  borderBottom: '1px solid #eee',
  textAlign: 'left',
  verticalAlign: 'top',
};

const headStyle: React.CSSProperties = {
  ...cellStyle,
  borderBottom: '2px solid #ddd',
  fontWeight: 600,
  color: '#555',
  fontSize: '0.8125rem',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};

const linkStyle: React.CSSProperties = {
  color: '#1d4ed8',
  textDecoration: 'none',
  fontWeight: 500,
};

const channelBadgeStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '0.125rem 0.5rem',
  borderRadius: 999,
  background: '#f3f4f6',
  border: '1px solid #e5e7eb',
  color: '#374151',
  fontSize: '0.8125rem',
  fontWeight: 500,
};

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
    <main
      style={{
        padding: '2rem',
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 960,
        margin: '0 auto',
      }}
    >
      <h1 style={{ marginBottom: '0.25rem' }}>Activity</h1>
      <p style={{ marginTop: 0, color: '#666' }}>
        Recent touchpoints across all contacts, newest first.
      </p>

      {items.length === 0 ? (
        <div
          style={{
            marginTop: '2rem',
            padding: '2rem',
            textAlign: 'center',
            color: '#666',
            background: '#fafafa',
            border: '1px solid #eee',
            borderRadius: 6,
          }}
        >
          <p style={{ margin: 0, fontSize: '1.05rem' }}>No activity yet.</p>
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
            Touchpoints will appear here as you log them against your contacts.
          </p>
        </div>
      ) : (
        <table
          style={{
            marginTop: '1.5rem',
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '0.9375rem',
          }}
        >
          <thead>
            <tr>
              <th style={headStyle} scope="col">
                Channel
              </th>
              <th style={headStyle} scope="col">
                Contact
              </th>
              <th style={headStyle} scope="col">
                Note
              </th>
              <th style={headStyle} scope="col">
                When
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td style={cellStyle}>
                  <span style={channelBadgeStyle}>{CHANNEL_LABELS[item.channel]}</span>
                </td>
                <td style={cellStyle}>
                  <Link href={`/contacts/${item.contactId}`} style={linkStyle}>
                    {item.contactName}
                  </Link>
                  {item.contactCompany ? (
                    <span style={{ display: 'block', color: '#888', fontSize: '0.8125rem' }}>
                      {item.contactCompany}
                    </span>
                  ) : null}
                </td>
                <td style={cellStyle}>
                  {item.note ? (
                    item.note
                  ) : (
                    <span style={{ color: '#aaa' }}>No note</span>
                  )}
                </td>
                <td style={{ ...cellStyle, color: '#666', whiteSpace: 'nowrap' }}>
                  {formatTimestamp(item.occurredAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
