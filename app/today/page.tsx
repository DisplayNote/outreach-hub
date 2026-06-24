import { redirect } from 'next/navigation';
import { inArray, desc } from 'drizzle-orm';
import { getSession } from '@/lib/auth/session';
import { withRls } from '@/lib/db/rls';
import { rlsCtxFromSession } from '@/lib/auth/session';
import { touchpoints } from '@/lib/db/schema';
import { getTodayContacts } from '@/lib/db/queries';
import type { Contact, TouchpointChannel } from '@/lib/types/domain';
import { Avatar, Badge, Card, EmptyState, Pill } from '@/components/ui';
import { STATUS_PILLS } from '@/lib/ui/status';
import { contactInitials } from '@/lib/ui/initials';

// Auth state + due-today data change per request; never prerender.
export const dynamic = 'force-dynamic';

// --- Display helpers ---------------------------------------------------------

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

  const session = await getSession();
  if (!session) return result;

  let rows: Array<{ contactId: string; channel: TouchpointChannel; occurredAt: string }>;
  try {
    rows = await withRls(rlsCtxFromSession(session), (tx) =>
      tx
        .select({
          contactId: touchpoints.contactId,
          channel: touchpoints.channel,
          occurredAt: touchpoints.occurredAt,
        })
        .from(touchpoints)
        .where(inArray(touchpoints.contactId, [...contactIds]))
        .orderBy(desc(touchpoints.occurredAt)),
    );
  } catch {
    // Last-touchpoint info is a nice-to-have on this read-only view; if it
    // fails we still render the due list rather than 500 the whole page.
    return result;
  }

  // Rows are newest-first, so the first one seen per contact is the latest.
  for (const row of rows) {
    if (!result.has(row.contactId)) {
      result.set(row.contactId, { channel: row.channel, occurredAt: row.occurredAt });
    }
  }

  return result;
}

// --- Page --------------------------------------------------------------------

export default async function TodayPage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const contacts = await getTodayContacts();
  const lastTouchpoints = await getLastTouchpoints(contacts.map((c) => c.id));
  const today = todayDateString();

  const dueCount = contacts.length;
  const dueLabel =
    dueCount === 0
      ? 'No follow-ups due today'
      : `${dueCount} ${dueCount === 1 ? 'follow-up' : 'follow-ups'} due today or overdue`;

  return (
    <div className="content__inner">
      <div className="page-head">
        <div>
          <div className="page-head__title">Today</div>
          <div className="page-head__sub">{dueLabel}.</div>
        </div>
      </div>

      <Card title="Due today" bodyStyle={{ padding: 0 }}>
        {contacts.length === 0 ? (
          <EmptyState
            icon="checkCircle"
            title="Nothing due today"
            desc="You're all caught up on follow-ups."
          />
        ) : (
          <div className="tbl-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Company</th>
                  <th scope="col">Status</th>
                  <th scope="col">Follow-up</th>
                  <th scope="col">Last touchpoint</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => {
                  const last = lastTouchpoints.get(contact.id);
                  const overdue = contact.followUp !== null && contact.followUp < today;

                  return (
                    <tr key={contact.id}>
                      <td>
                        <div className="row gap-5 center">
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
                        </div>
                      </td>
                      <td className="sm muted">{contact.company ?? '—'}</td>
                      <td>
                        <Pill spec={STATUS_PILLS[contact.status]} />
                      </td>
                      <td className="sm">
                        {contact.followUp ? (
                          <span className="row gap-3 center">
                            <span>{formatDate(contact.followUp)}</span>
                            {overdue ? <Badge tone="danger">Overdue</Badge> : null}
                          </span>
                        ) : (
                          <span className="tert">—</span>
                        )}
                      </td>
                      <td className="sm muted" style={{ whiteSpace: 'nowrap' }}>
                        {last ? (
                          <>
                            {CHANNEL_LABELS[last.channel]}
                            <span className="tert">
                              {' · '}
                              {formatTimestamp(last.occurredAt)}
                            </span>
                          </>
                        ) : (
                          <span className="tert">No touchpoints</span>
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
    </div>
  );
}
