import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getOrgSettings, getTodayContacts } from '@/lib/supabase/queries';
import { pickDialNumber } from '@/lib/dialler/normalise';
import { isDiallerMockEnabled } from '@/lib/env';
import type { Contact } from '@/lib/types/domain';
import { Icon } from '@/components/ui';
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
    <div className="content__inner">
      <div className="page-head">
        <div>
          <div className="page-head__title">AMD Run</div>
          <div className="page-head__sub">
            Server-orchestrated dialling with answering-machine detection.
          </div>
        </div>
        <div className="page-actions">
          <Link href="/dialler" className="btn btn--secondary btn--md">
            <Icon name="chevronsLeft" size={16} />
            <span>Back to dialler</span>
          </Link>
        </div>
      </div>

      {isDiallerMockEnabled() ? (
        <div className="banner banner--warning" style={{ marginBottom: 'var(--space-6)' }}>
          <span className="banner__icon">
            <Icon name="voicemail" size={16} />
          </span>
          <span>Mock dialler — no real calls placed</span>
        </div>
      ) : null}

      <AmdRun queue={queue} callDelayMs={callDelayMs} />
    </div>
  );
}
