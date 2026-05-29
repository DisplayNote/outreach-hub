import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { listContacts } from '@/lib/supabase/queries';
import type { ContactWithCampaign } from '@/lib/supabase/queries';
import type { ContactStatus } from '@/lib/types/domain';

// Auth state + the contact list change per request; never prerender (ADR 004).
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

/** A small swatch colour per status, mirroring the pipeline view. */
const STATUS_COLORS: Record<ContactStatus, string> = {
  none: '#9ca3af',
  amber: '#f59e0b',
  red: '#ef4444',
  green: '#22c55e',
  meeting: '#3b82f6',
  notinterested: '#6b7280',
  bounced: '#78716c',
};

/** Full name from first/last, falling back to email or a placeholder. */
function contactName(contact: ContactWithCampaign): string {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
  if (name) return name;
  if (contact.email) return contact.email;
  return 'Unnamed contact';
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

const newContactLinkStyle: React.CSSProperties = {
  padding: '0.45rem 0.9rem',
  background: '#111',
  color: '#fff',
  textDecoration: 'none',
  borderRadius: 6,
  fontSize: '0.9rem',
  fontWeight: 500,
  whiteSpace: 'nowrap',
};

const rowLinkStyle: React.CSSProperties = {
  textDecoration: 'none',
  color: '#111',
  fontWeight: 500,
};

// --- Page --------------------------------------------------------------------

export default async function ContactsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const contacts = await listContacts();

  return (
    <main
      style={{
        padding: '2rem',
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 960,
        margin: '0 auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '1rem',
        }}
      >
        <div>
          <h1 style={{ marginBottom: '0.25rem' }}>Contacts</h1>
          <p style={{ marginTop: 0, color: '#666' }}>
            Everyone in your organisation&rsquo;s outreach.
          </p>
        </div>
        <Link href="/contacts/new" style={newContactLinkStyle}>
          New contact
        </Link>
      </div>

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
          <p style={{ margin: 0, fontSize: '1.05rem' }}>No contacts yet.</p>
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
            <Link href="/contacts/new">Add your first contact</Link> to get started.
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
                Campaign
              </th>
              <th style={headStyle} scope="col">
                Follow-up
              </th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((contact) => (
              <tr key={contact.id}>
                <td style={cellStyle}>
                  <Link href={`/contacts/${contact.id}`} style={rowLinkStyle}>
                    {contactName(contact)}
                  </Link>
                  {contact.jobTitle ? (
                    <span style={{ display: 'block', color: '#888', fontSize: '0.8125rem' }}>
                      {contact.jobTitle}
                    </span>
                  ) : null}
                </td>
                <td style={cellStyle}>{contact.company ?? '—'}</td>
                <td style={cellStyle}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span
                      aria-hidden="true"
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: STATUS_COLORS[contact.status],
                        flexShrink: 0,
                      }}
                    />
                    {STATUS_LABELS[contact.status]}
                  </span>
                </td>
                <td style={cellStyle}>{contact.campaignName}</td>
                <td style={cellStyle}>
                  {contact.followUp ? formatDate(contact.followUp) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
