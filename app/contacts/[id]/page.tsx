import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getContact, getContactTouchpoints, getOrgSettings } from '@/lib/supabase/queries';
import type { Contact, Touchpoint, TouchpointChannel } from '@/lib/types/domain';
import { CONTACT_STATUSES, TOUCHPOINT_CHANNELS } from '@/lib/types/domain';
import { logTouchpointForm } from '@/app/contacts/[id]/actions';
import StatusSelect from '@/app/contacts/[id]/status-select';
import ClickToCall from '@/components/click-to-call';
import { Avatar, Button, Card, EmptyState, Field, Icon, Pill } from '@/components/ui';
import { STATUS_PILLS, STATUS_LABELS } from '@/lib/ui/status';
import { contactInitials } from '@/lib/ui/initials';

// Auth state + contact data change per request; never prerender.
export const dynamic = 'force-dynamic';

// --- Display helpers ---------------------------------------------------------

const CHANNEL_LABELS: Record<TouchpointChannel, string> = {
  email: 'Email',
  phone: 'Phone',
  linkedin: 'LinkedIn',
  other: 'Other',
};

/** Icon name for each touchpoint channel, used by the history timeline dots. */
const CHANNEL_ICONS: Record<TouchpointChannel, string> = {
  email: 'mail',
  phone: 'phone',
  linkedin: 'info',
  other: 'dot',
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

/** Up-to-two-letter initials for the avatar, derived from name/email. */
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
    <div className="content__inner">
      <div className="page-head">
        <div>
          <Link href="/today" className="sm muted row gap-3 center" style={{ marginBottom: 'var(--space-4)' }}>
            <Icon name="chevronsLeft" size={14} />
            Back to Today
          </Link>
          <div className="row gap-5 center">
            <Avatar initials={contactInitials(contact)} size="lg" />
            <div style={{ minWidth: 0 }}>
              <div className="row gap-4 center">
                <span className="page-head__title">{contactName(contact)}</span>
                <Pill spec={STATUS_PILLS[contact.status]} />
              </div>
              <div className="page-head__sub">
                {contact.jobTitle ? `${contact.jobTitle}` : null}
                {contact.jobTitle && contact.company ? ' · ' : null}
                {contact.company ?? null}
                {!contact.jobTitle && !contact.company ? 'No company on file' : null}
              </div>
            </div>
          </div>
        </div>
        <div className="page-actions row gap-4 center" style={{ flexWrap: 'wrap' }}>
          <StatusSelect contactId={contact.id} current={contact.status} options={STATUS_OPTIONS} />
          <Link href={`/contacts/${contact.id}/edit`} className="btn btn--secondary btn--md">
            <span>Edit</span>
          </Link>
        </div>
      </div>

      <div className="detail-grid">
        {/* Details */}
        <div className="col gap-6">
          <Card title="Details" bodyStyle={{ padding: 0 }}>
            <div className="tbl-wrap" style={{ border: 'none', borderRadius: 0 }}>
              <table className="tbl">
                <tbody>
                  {detailFields.map((field) => (
                    <tr key={field.label}>
                      <th scope="row" className="sm muted" style={{ width: '12rem', fontWeight: 'var(--fw-medium)' }}>
                        {field.label}
                      </th>
                      <td className="sm">
                        {field.value === null ? (
                          <span className="tert">—</span>
                        ) : field.href ? (
                          <a
                            href={field.href}
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
            </div>
          </Card>

          {contact.notes ? (
            <Card title="Notes">
              <p className="sm" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                {contact.notes}
              </p>
            </Card>
          ) : null}
        </div>

        {/* Log touchpoint + history */}
        <div className="col gap-6">
          <ClickToCall
            contactId={contact.id}
            contactName={contactName(contact)}
            phone={contact.phone}
            mobile={contact.mobile}
            defaultCountryCode={defaultCountryCode}
          />

          <Card title="Log touchpoint">
            <form action={logTouchpointForm} className="col gap-5">
              <input type="hidden" name="id" value={contact.id} />
              <Field label="Channel" htmlFor="touchpoint-channel">
                <div className="select-wrap">
                  <select id="touchpoint-channel" name="channel" defaultValue="email" className="input">
                    {TOUCHPOINT_CHANNELS.map((channel) => (
                      <option key={channel} value={channel}>
                        {CHANNEL_LABELS[channel]}
                      </option>
                    ))}
                  </select>
                  <span className="select-chevron">
                    <Icon name="chevronDown" size={15} />
                  </span>
                </div>
              </Field>
              <Field label="Note (optional)" htmlFor="touchpoint-note">
                <textarea
                  id="touchpoint-note"
                  name="note"
                  rows={3}
                  className="input"
                  placeholder="What happened?"
                />
              </Field>
              <div>
                <Button type="submit" variant="primary">
                  Log touchpoint
                </Button>
              </div>
            </form>
          </Card>

          <Card title="History">
            {touchpoints.length === 0 ? (
              <EmptyState icon="inbox" title="No touchpoints yet" desc="Logged touchpoints will appear here." />
            ) : (
              <div className="timeline">
                {touchpoints.map((tp) => (
                  <div key={tp.id} className="tl-item">
                    <div className="tl-dot">
                      <Icon name={CHANNEL_ICONS[tp.channel]} size={13} />
                    </div>
                    <div className="tl-card">
                      <div className="row between center" style={{ marginBottom: tp.note ? 6 : 0 }}>
                        <span className="sm semib">{CHANNEL_LABELS[tp.channel]}</span>
                        <span className="tl-when" style={{ whiteSpace: 'nowrap' }}>
                          {formatTimestamp(tp.occurredAt)}
                        </span>
                      </div>
                      {tp.note ? (
                        <div className="sm muted" style={{ whiteSpace: 'pre-wrap' }}>
                          {tp.note}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
