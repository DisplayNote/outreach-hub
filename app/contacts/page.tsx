import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { listContacts } from '@/lib/supabase/queries';
import type { ContactWithCampaign } from '@/lib/supabase/queries';
import { Avatar, Card, EmptyState, Icon, Pill } from '@/components/ui';
import { STATUS_PILLS } from '@/lib/ui/status';
import { contactInitials } from '@/lib/ui/initials';

// Auth state + the contact list change per request; never prerender (ADR 004).
export const dynamic = 'force-dynamic';

// --- Display helpers ---------------------------------------------------------

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
    <div className="content__inner">
      <div className="page-head">
        <div>
          <div className="page-head__title">Contacts</div>
          <div className="page-head__sub">Everyone in your organisation&rsquo;s outreach.</div>
        </div>
        <div className="page-actions">
          <Link href="/contacts/new" className="btn btn--primary btn--md">
            <Icon name="userPlus" size={16} />
            <span>New contact</span>
          </Link>
        </div>
      </div>

      <Card title="All contacts" bodyStyle={{ padding: 0 }}>
        {contacts.length === 0 ? (
          <EmptyState
            icon="contacts"
            title="No contacts yet"
            desc="Add your first contact to get started."
            action={
              <Link href="/contacts/new" className="btn btn--primary btn--md">
                <Icon name="userPlus" size={16} />
                <span>New contact</span>
              </Link>
            }
          />
        ) : (
          <div className="tbl-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Company</th>
                  <th scope="col">Status</th>
                  <th scope="col">Campaign</th>
                  <th scope="col">Follow-up</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => (
                  <tr key={contact.id}>
                    <td>
                      <Link href={`/contacts/${contact.id}`} className="row gap-5 center">
                        <Avatar initials={contactInitials(contact)} size="sm" />
                        <div style={{ minWidth: 0 }}>
                          <div className="medb" style={{ whiteSpace: 'nowrap' }}>
                            {contactName(contact)}
                          </div>
                          {contact.jobTitle ? (
                            <div className="cap tert" style={{ whiteSpace: 'nowrap' }}>
                              {contact.jobTitle}
                            </div>
                          ) : null}
                        </div>
                      </Link>
                    </td>
                    <td className="sm muted">{contact.company ?? '—'}</td>
                    <td>
                      <Pill spec={STATUS_PILLS[contact.status]} />
                    </td>
                    <td className="sm">{contact.campaignName}</td>
                    <td className="sm">
                      {contact.followUp ? formatDate(contact.followUp) : <span className="tert">—</span>}
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
