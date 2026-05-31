import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getTodayContacts } from '@/lib/supabase/queries';
import type { Contact, ContactStatus, TouchpointChannel } from '@/lib/types/domain';

// Auth state + due-today data change per request; never prerender.
export const dynamic = 'force-dynamic';

// --- Display helpers ---------------------------------------------------------

/** Human-readable label for each contact status. */
const STATUS_LABELS: Record<ContactStatus, string> = {
  none: 'No status',
  amber: 'Amber',
  red: 'Red',
  green: 'Green',
  meeting: 'Meeting',
  notinterested: 'Not interested',
  bounced: 'Bounced',
};

/** Human-readable label for each touchpoint channel. */
const CHANNEL_LABELS: Record<TouchpointChannel, string> = {
  email: 'Email',
  phone: 'Phone',
  linkedin: 'LinkedIn',
  other: 'Other',
};

/** Full name from first/last, falling back to email or a placeholder. */
function contactName(contact: Contact): string {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
  if (name) return name;
  if (contact.email) return contact.email;
  return 'Unnamed contact';
}

/** `YYYY-MM-DD` today, in UTC, to match how `follow_up` (a SQL date) is compared. */
function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Format an ISO `YYYY-MM-DD` follow-up date for display. */
function formatDate(isoDate: string): string {
  // Parse as UTC midnight so the displayed day matches the stored `date`.
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Format an ISO timestamp (date + time) for the last-touchpoint column.
 * `occurred_at` is a `timestamptz`, so include the time — otherwise multiple
 * touchpoints on the same day are indistinguishable.
 */
function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// --- Last-touchpoint lookup --------------------------------------------------

interface LastTouchpoint {
  channel: TouchpointChannel;
  occurredAt: string;
}

/**
 * Fetch the most-recent touchpoint per contact in one RLS-scoped query, then
 * reduce to a map keyed by contact id. Read-only and bounded by the due set.
 */
async function getLastTouchpoints(
  contactIds: readonly string[],
): Promise<Map<string, LastTouchpoint>> {
  const result = new Map<string, LastTouchpoint>();
  if (contactIds.length === 0) return result;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('touchpoints')
    .select('contact_id, channel, occurred_at')
    .in('contact_id', [...contactIds])
    .order('occurred_at', { ascending: false });

  if (error) {
    // Last-touchpoint info is a nice-to-have on this read-only view; if it
    // fails we still render the due list rather than 500 the whole page.
    return result;
  }

  const rows =
    (data as Array<{
      contact_id: string;
      channel: TouchpointChannel;
      occurred_at: string;
    }> | null) ?? [];

  // Rows are newest-first, so the first one seen per contact is the latest.
  for (const row of rows) {
    if (!result.has(row.contact_id)) {
      result.set(row.contact_id, { channel: row.channel, occurredAt: row.occurred_at });
    }
  }

  return result;
}

// --- Inline styles (Tailwind is not wired yet; mirror app/page.tsx) ----------

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

// --- Page --------------------------------------------------------------------

export default async function TodayPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const contacts = await getTodayContacts();
  const lastTouchpoints = await getLastTouchpoints(contacts.map((c) => c.id));
  const today = todayDateString();

  return (
    <main
      style={{
        padding: '2rem',
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 960,
        margin: '0 auto',
      }}
    >
      <h1 style={{ marginBottom: '0.25rem' }}>Today</h1>
      <p style={{ marginTop: 0, color: '#666' }}>
        Contacts due today or overdue for follow-up.
      </p>

      {contacts.length === 0 ? (
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
          <p style={{ margin: 0, fontSize: '1.05rem' }}>Nothing due today.</p>
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
            You&rsquo;re all caught up on follow-ups.
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
                Name
              </th>
              <th style={headStyle} scope="col">
                Company
              </th>
              <th style={headStyle} scope="col">
                Status
              </th>
              <th style={headStyle} scope="col">
                Follow-up
              </th>
              <th style={headStyle} scope="col">
                Last touchpoint
              </th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((contact) => {
              const last = lastTouchpoints.get(contact.id);
              const overdue = contact.followUp !== null && contact.followUp < today;

              return (
                <tr key={contact.id}>
                  <td style={cellStyle}>
                    <span style={{ fontWeight: 500 }}>{contactName(contact)}</span>
                    {contact.jobTitle ? (
                      <span style={{ display: 'block', color: '#888', fontSize: '0.8125rem' }}>
                        {contact.jobTitle}
                      </span>
                    ) : null}
                  </td>
                  <td style={cellStyle}>{contact.company ?? '—'}</td>
                  <td style={cellStyle}>{STATUS_LABELS[contact.status]}</td>
                  <td style={cellStyle}>
                    {contact.followUp ? (
                      <>
                        {formatDate(contact.followUp)}
                        {overdue ? (
                          <span
                            style={{
                              marginLeft: '0.5rem',
                              color: '#b91c1c',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              textTransform: 'uppercase',
                            }}
                          >
                            Overdue
                          </span>
                        ) : null}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td style={cellStyle}>
                    {last ? (
                      <>
                        {CHANNEL_LABELS[last.channel]}
                        <span style={{ color: '#888' }}>
                          {' · '}
                          {formatTimestamp(last.occurredAt)}
                        </span>
                      </>
                    ) : (
                      <span style={{ color: '#aaa' }}>No touchpoints</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
