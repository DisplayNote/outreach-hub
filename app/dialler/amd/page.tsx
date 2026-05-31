import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getOrgSettings, getTodayContacts } from '@/lib/supabase/queries';
import { pickDialNumber } from '@/lib/dialler/normalise';
import { isDiallerMockEnabled } from '@/lib/env';
import type { Contact } from '@/lib/types/domain';
import AmdRun from '@/components/amd-run';
import type { DiallerQueueItem } from '@/components/dialler-run';

// Auth state + the due-call queue change per request; never prerender.
export const dynamic = 'force-dynamic';

function contactName(contact: Contact): string {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
  if (name) return name;
  if (contact.email) return contact.email;
  return 'Unnamed contact';
}

interface AmdPageProps {
  searchParams: Promise<{ campaign?: string | string[] }>;
}

/**
 * AMD ("Mode B") run view — auth-gated server component. Builds the same
 * due-today, dialable queue as the Mode-A dialler, then hands it to the
 * {@link AmdRun} client controller, which orchestrates server-side AMD dialling
 * over Realtime. Statuses `notinterested` / `bounced` are excluded by default.
 */
export default async function AmdPage({ searchParams }: AmdPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const params = await searchParams;
  const rawCampaign = Array.isArray(params.campaign) ? params.campaign[0] : params.campaign;
  const campaignFilter = rawCampaign && rawCampaign !== '' ? rawCampaign : null;

  const [dueContacts, settings] = await Promise.all([getTodayContacts(), getOrgSettings()]);
  const defaultCountryCode = settings.defaultCountryCode ?? '+44';
  const callDelayMs = typeof settings.txCallDelay === 'number' ? settings.txCallDelay * 1000 : 3000;

  const queue: DiallerQueueItem[] = dueContacts
    .filter((c) => campaignFilter === null || c.campaignId === campaignFilter)
    .filter((c) => c.status !== 'notinterested' && c.status !== 'bounced')
    .flatMap((c) => {
      const dialNumber = pickDialNumber(c, defaultCountryCode);
      if (dialNumber === null) return [];
      return [
        {
          id: c.id,
          name: contactName(c),
          company: c.company,
          jobTitle: c.jobTitle,
          status: c.status,
          dialNumber,
        } satisfies DiallerQueueItem,
      ];
    });

  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ marginBottom: '0.25rem' }}>AMD Run</h1>
      <p style={{ marginTop: 0, color: '#666' }}>
        Server-orchestrated dialling with answering-machine detection. <Link href="/dialler">← Back to dialler</Link>
      </p>
      {isDiallerMockEnabled() ? (
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
          Mock dialler — no real calls placed
        </p>
      ) : null}

      <AmdRun queue={queue} callDelayMs={callDelayMs} />
    </main>
  );
}
