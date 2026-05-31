import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getContact, getContactTouchpoints, getOrgSettings } from '@/lib/supabase/queries';
import type { Contact, ContactStatus, Touchpoint, TouchpointChannel } from '@/lib/types/domain';
import { CONTACT_STATUSES, TOUCHPOINT_CHANNELS } from '@/lib/types/domain';
import { logTouchpointForm } from '@/app/contacts/[id]/actions';
import StatusSelect from '@/app/contacts/[id]/status-select';
import ClickToCall from '@/components/click-to-call';

// Auth state + contact data change per request; never prerender.
export const dynamic = 'force-dynamic';

// --- Display helpers ---------------------------------------------------------

const STATUS_LABELS: Record<ContactStatus, string> = {
  none: 'No status',
  amber: 'Amber',
  red: 'Red',
  green: 'Green',
  meeting: 'Meeting',
  notinterested: 'Not interested',
  bounced: 'Bounced',
};

const CHANNEL_LABELS: Record<TouchpointChannel, string> = {
  email: 'Email',
  phone: 'Phone',
  linkedin: 'LinkedIn',
  other: 'Other',
};

const STATUS_OPTIONS = CONTACT_STATUSES.map((value) => ({
  value,
  label: STATUS_LABELS[value],
}));

/** Full name from first/last, falling back to email or a placeholder. */
function contactName(contact: Contact): string {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
  if (name) return name;
  if (contact.email) return contact.email;
  return 'Unnamed contact';
}

/** Format an ISO `YYYY-MM-DD` date for display. */
function formatDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Format an ISO timestamp (date + time) for the touchpoint log. */
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

// --- Inline styles (Tailwind is not wired yet; mirror app/today/page.tsx) ----

const cardStyle: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  padding: '1.25rem 1.5rem',
  background: 'white',
};

const sectionTitleStyle: React.CSSProperties = {
  margin: '0 0 0.75rem',
  fontSize: '0.8125rem',
  fontWeight: 600,
  color: '#555',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};

const detailCellStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  borderBottom: '1px solid #f0f0f0',
  textAlign: 'left',
  verticalAlign: 'top',
  fontSize: '0.9375rem',
};

const detailLabelStyle: React.CSSProperties = {
  ...detailCellStyle,
  color: '#888',
  width: '12rem',
  fontWeight: 500,
};

const fieldLabelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8125rem',
  color: '#555',
  marginBottom: '0.25rem',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.6rem',
  fontSize: '0.9375rem',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  background: 'white',
  boxSizing: 'border-box',
};

const primaryButtonStyle: React.CSSProperties = {
  padding: '0.55rem 1rem',
  fontSize: '0.9375rem',
  cursor: 'pointer',
  background: '#2f2f2f',
  color: 'white',
  border: 0,
  borderRadius: 4,
};

// --- Detail rows -------------------------------------------------------------

interface DetailField {
  label: string;
  value: string | null;
  href?: string;
}

function buildDetailFields(contact: Contact): DetailField[] {
  const fields: DetailField[] = [
    { label: 'Email', value: contact.email, ...(contact.email ? { href: `mailto:${contact.email}` } : {}) },
    { label: 'Company', value: contact.company },
    { label: 'Job title', value: contact.jobTitle },
    { label: 'Seniority', value: contact.seniority },
    { label: 'Phone', value: contact.phone },
    { label: 'Mobile', value: contact.mobile },
    { label: 'Country', value: contact.country },
    {
      label: 'LinkedIn',
      value: contact.linkedin,
      ...(contact.linkedin ? { href: contact.linkedin } : {}),
    },
    {
      label: 'Sequence day',
      value: contact.sequenceDay === null ? null : String(contact.sequenceDay),
    },
    { label: 'Follow-up', value: contact.followUp ? formatDate(contact.followUp) : null },
  ];
  return fields;
}

// --- Page --------------------------------------------------------------------

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const contact = await getContact(id);
  if (!contact) {
    // RLS returns no row for unknown ids or other orgs — render a 404.
    notFound();
  }

  const touchpoints: Touchpoint[] = await getContactTouchpoints(contact.id);
  const settings = await getOrgSettings();
  const defaultCountryCode = settings.defaultCountryCode ?? '+44';
  const detailFields = buildDetailFields(contact);

  return (
    <main
      style={{
        padding: '2rem',
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 960,
        margin: '0 auto',
      }}
    >
      <p style={{ margin: '0 0 0.75rem', fontSize: '0.875rem' }}>
        <Link href="/today" style={{ color: '#2563eb', textDecoration: 'none' }}>
          ← Back to Today
        </Link>
      </p>

      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <div>
          <h1 style={{ margin: '0 0 0.25rem' }}>{contactName(contact)}</h1>
          <p style={{ margin: 0, color: '#666' }}>
            {contact.jobTitle ? `${contact.jobTitle}` : null}
            {contact.jobTitle && contact.company ? ' · ' : null}
            {contact.company ?? null}
            {!contact.jobTitle && !contact.company ? 'No company on file' : null}
          </p>
        </div>
        <Link
          href={`/contacts/${contact.id}/edit`}
          style={{
            padding: '0.5rem 0.9rem',
            fontSize: '0.9375rem',
            textDecoration: 'none',
            color: '#374151',
            background: '#f3f4f6',
            border: '1px solid #d1d5db',
            borderRadius: 4,
            whiteSpace: 'nowrap',
          }}
        >
          Edit
        </Link>
      </header>

      <section
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          marginBottom: '1.5rem',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: '0.8125rem', color: '#555', fontWeight: 600 }}>STATUS</span>
        <StatusSelect contactId={contact.id} current={contact.status} options={STATUS_OPTIONS} />
        <span style={{ color: '#888', fontSize: '0.875rem' }}>
          Currently: {STATUS_LABELS[contact.status]}
        </span>
      </section>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
          gap: '1.5rem',
          alignItems: 'start',
        }}
      >
        {/* Details */}
        <section style={cardStyle}>
          <h2 style={sectionTitleStyle}>Details</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {detailFields.map((field) => (
                <tr key={field.label}>
                  <th scope="row" style={detailLabelStyle}>
                    {field.label}
                  </th>
                  <td style={detailCellStyle}>
                    {field.value === null ? (
                      <span style={{ color: '#aaa' }}>—</span>
                    ) : field.href ? (
                      <a
                        href={field.href}
                        style={{ color: '#2563eb', textDecoration: 'none' }}
                        {...(field.href.startsWith('http')
                          ? { target: '_blank', rel: 'noopener noreferrer' }
                          : {})}
                      >
                        {field.value}
                      </a>
                    ) : (
                      field.value
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {contact.notes ? (
            <div style={{ marginTop: '1rem' }}>
              <h2 style={sectionTitleStyle}>Notes</h2>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '0.9375rem' }}>
                {contact.notes}
              </p>
            </div>
          ) : null}
        </section>

        {/* Log touchpoint + history */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <ClickToCall
            contactId={contact.id}
            contactName={contactName(contact)}
            phone={contact.phone}
            mobile={contact.mobile}
            defaultCountryCode={defaultCountryCode}
          />

          <section style={cardStyle}>
            <h2 style={sectionTitleStyle}>Log touchpoint</h2>
            <form action={logTouchpointForm} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <input type="hidden" name="id" value={contact.id} />
              <div>
                <label htmlFor="touchpoint-channel" style={fieldLabelStyle}>
                  Channel
                </label>
                <select
                  id="touchpoint-channel"
                  name="channel"
                  defaultValue="email"
                  style={inputStyle}
                >
                  {TOUCHPOINT_CHANNELS.map((channel) => (
                    <option key={channel} value={channel}>
                      {CHANNEL_LABELS[channel]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="touchpoint-note" style={fieldLabelStyle}>
                  Note <span style={{ color: '#aaa' }}>(optional)</span>
                </label>
                <textarea
                  id="touchpoint-note"
                  name="note"
                  rows={3}
                  style={{ ...inputStyle, resize: 'vertical' }}
                  placeholder="What happened?"
                />
              </div>
              <button type="submit" style={primaryButtonStyle}>
                Log touchpoint
              </button>
            </form>
          </section>

          <section style={cardStyle}>
            <h2 style={sectionTitleStyle}>History</h2>
            {touchpoints.length === 0 ? (
              <p style={{ margin: 0, color: '#888', fontSize: '0.9375rem' }}>
                No touchpoints logged yet.
              </p>
            ) : (
              <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {touchpoints.map((tp) => (
                  <li
                    key={tp.id}
                    style={{
                      padding: '0.6rem 0',
                      borderBottom: '1px solid #f0f0f0',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: '0.75rem',
                      }}
                    >
                      <span style={{ fontWeight: 500, fontSize: '0.9375rem' }}>
                        {CHANNEL_LABELS[tp.channel]}
                      </span>
                      <span style={{ color: '#888', fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>
                        {formatTimestamp(tp.occurredAt)}
                      </span>
                    </div>
                    {tp.note ? (
                      <p
                        style={{
                          margin: '0.25rem 0 0',
                          fontSize: '0.9375rem',
                          whiteSpace: 'pre-wrap',
                          color: '#374151',
                        }}
                      >
                        {tp.note}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
