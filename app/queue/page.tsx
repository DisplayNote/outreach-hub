import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentOrgId } from '@/lib/supabase/org';
import { getOrgSettings, listCampaigns, listSequences } from '@/lib/supabase/queries';
import { getEmailDriver } from '@/lib/email/index';
import { supabaseEmailStore } from '@/lib/email/store';
import { renderTemplate } from '@/lib/email/render';
import { isEmailMockEnabled } from '@/lib/env';
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

  const queue: QueueItem[] = due.map((d) => ({
    contactId: d.contact.id,
    name: contactName(d.contact.firstName, d.contact.lastName, d.contact.email),
    email: d.contact.email ?? '',
    sequenceDay: d.step.dayOffset,
    subject: renderTemplate(d.template ?? { subject: null, body: null }, d.contact, settings).subject,
  }));

  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif', maxWidth: 820, margin: '0 auto' }}>
      <h1 style={{ marginBottom: '0.25rem' }}>Email Queue</h1>
      <p style={{ marginTop: 0, color: '#666' }}>
        Contacts due to be emailed today. The runner sends the right sequence step, logs it, and
        schedules the next follow-up.
      </p>
      {isEmailMockEnabled() ? (
        <p
          style={{
            display: 'inline-block',
            margin: '0.5rem 0 0',
            padding: '0.2rem 0.6rem',
            fontSize: '0.75rem',
            fontWeight: 600,
            color: '#92400e',
            background: '#fef3c7',
            borderRadius: 4,
          }}
        >
          Mock email — no real mail sent ({driver.name})
        </p>
      ) : null}

      <EmailRunner
        queue={queue}
        emailMockEnabled={isEmailMockEnabled()}
        campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
        sequences={sequences.map((s) => ({ id: s.id, name: s.name }))}
      />
    </main>
  );
}
