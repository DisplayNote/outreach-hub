import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentOrgId } from '@/lib/auth/org';
import { getOrgSettings, listCampaigns, listSequences } from '@/lib/supabase/queries';
import { campaignSequenceStatuses } from '@/lib/campaigns/sequence-status';
import { getEmailDriver } from '@/lib/email/index';
import { supabaseEmailStore } from '@/lib/email/store';
import { renderTemplate } from '@/lib/email/render';
import { isEmailMockEnabled } from '@/lib/env';
import { Icon } from '@/components/ui';
import EmailRunner, { type QueueItem } from '@/components/email-runner';

// Auth + the due queue change per request; never prerender.
export const dynamic = 'force-dynamic';

function contactName(firstName: string | null, lastName: string | null, email: string | null): string {
  const name = [firstName, lastName].filter(Boolean).join(' ').trim();
  return name || email || 'Unnamed contact';
}

/**
 * Email Queue — auth-gated server component (PHASE_5_SPEC §10). Builds the
 * due-today list (with the rendered subject per contact's current step) via the
 * EmailStore, and hands it to the {@link EmailRunner} client controller for the
 * "Run sender now" / "Scan inbox now" / enrol / simulate actions.
 */
export default async function QueuePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const orgId = await getCurrentOrgId();
  const settings = await getOrgSettings();
  const driver = getEmailDriver();
  const store = supabaseEmailStore(supabase, { orgId, provider: driver.name, settings });

  const today = new Date().toISOString().slice(0, 10);
  const due = await store.dueContacts(today);
  const [campaigns, sequences] = await Promise.all([listCampaigns(), listSequences()]);

  // Resolve each campaign's linked-sequence name from sequence_id (the link the
  // runner follows), not the stale-able free-text column — see sequence-status.
  const campaignStatuses = campaignSequenceStatuses(campaigns, sequences);

  // How many contacts are enrolled at all (follow_up set) — a contact only ever
  // reaches the due queue once enrolled, so this distinguishes "nobody enrolled
  // yet" from "enrolled but not due today". RLS scopes the count to the org.
  const { count: enrolledCount } = await supabase
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .not('follow_up', 'is', null);

  const queue: QueueItem[] = due.map((d) => ({
    contactId: d.contact.id,
    name: contactName(d.contact.firstName, d.contact.lastName, d.contact.email),
    email: d.contact.email ?? '',
    sequenceDay: d.sequenceDay,
    subject: renderTemplate(d.template ?? { subject: null, body: null }, d.contact, settings).subject,
  }));

  const dueCount = queue.length;
  const dueLabel =
    dueCount === 0
      ? 'Nobody is due to be emailed today'
      : `${dueCount} ${dueCount === 1 ? 'contact' : 'contacts'} due today`;

  return (
    <div className="content__inner">
      <div className="page-head">
        <div>
          <div className="page-head__title">Email Queue</div>
          <div className="page-head__sub">
            {dueLabel}. The runner sends the right sequence step, logs it, and schedules the next
            follow-up.
          </div>
        </div>
      </div>

      {isEmailMockEnabled() ? (
        <div className="banner banner--warning" style={{ marginBottom: 'var(--space-6)' }}>
          <span className="banner__icon">
            <Icon name="alert" size={16} />
          </span>
          <span>
            <b>Mock email</b> — no real mail sent ({driver.name}).
          </span>
        </div>
      ) : null}

      <EmailRunner
        queue={queue}
        emailMockEnabled={isEmailMockEnabled()}
        campaigns={campaignStatuses}
        enrolledCount={enrolledCount ?? 0}
      />
    </div>
  );
}
