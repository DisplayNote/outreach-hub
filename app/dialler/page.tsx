import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getOrgSettings, getTodayContacts, listCampaigns } from '@/lib/supabase/queries';
import { pickDialNumber } from '@/lib/dialler/normalise';
import type { Contact } from '@/lib/types/domain';
import DiallerRun, { type DiallerQueueItem } from '@/components/dialler-run';

// Auth state + the due-call queue change per request; never prerender.
export const dynamic = 'force-dynamic';

/** Full name from first/last, falling back to email or a placeholder. */
function contactName(contact: Contact): string {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
  if (name) return name;
  if (contact.email) return contact.email;
  return 'Unnamed contact';
}

interface DiallerPageProps {
  // Next 15: searchParams is async.
  searchParams: Promise<{ campaign?: string | string[] }>;
}

/**
 * Dialler run view — auth-gated server component.
 *
 * Builds the call queue from contacts due today or overdue (`getTodayContacts`)
 * that have a dialable phone/mobile number. An optional `?campaign=<id>` query
 * param narrows the queue to a single campaign. Phone numbers are normalised to
 * E.164 server-side (using the org's `defaultCountryCode`) so the client only
 * receives ready-to-dial entries; contacts with no usable number are dropped.
 *
 * The interactive run itself is delegated to the `DiallerRun` client component.
 */
export default async function DiallerPage({ searchParams }: DiallerPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const params = await searchParams;
  const rawCampaign = Array.isArray(params.campaign) ? params.campaign[0] : params.campaign;
  const campaignFilter = rawCampaign && rawCampaign !== '' ? rawCampaign : null;

  const [dueContacts, campaigns, settings] = await Promise.all([
    getTodayContacts(),
    listCampaigns(),
    getOrgSettings(),
  ]);

  const defaultCountryCode = settings.defaultCountryCode ?? '+44';

  // Narrow by campaign (if requested), then keep only contacts we can dial.
  const queue: DiallerQueueItem[] = dueContacts
    .filter((c) => campaignFilter === null || c.campaignId === campaignFilter)
    .flatMap((c) => {
      const dialNumber = pickDialNumber(c, defaultCountryCode);
      if (dialNumber === null) return [];
      const item: DiallerQueueItem = {
        id: c.id,
        name: contactName(c),
        company: c.company,
        jobTitle: c.jobTitle,
        status: c.status,
        dialNumber,
      };
      return [item];
    });

  return (
    <main
      style={{
        padding: '2rem',
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 720,
        margin: '0 auto',
      }}
    >
      <h1 style={{ marginBottom: '0.25rem' }}>Dialler</h1>
      <p style={{ marginTop: 0, color: '#666' }}>
        Work through your due calls one contact at a time.{' '}
        <Link href="/dialler/amd">Start an AMD run →</Link>
      </p>

      {/* Campaign filter — a plain GET form so it works without client JS. */}
      <form
        method="get"
        style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}
      >
        <label htmlFor="campaign" style={{ fontSize: '0.875rem', color: '#374151' }}>
          Campaign
        </label>
        <select
          id="campaign"
          name="campaign"
          defaultValue={campaignFilter ?? ''}
          style={{
            padding: '0.4rem 0.6rem',
            border: '1px solid #d1d5db',
            borderRadius: 4,
            fontSize: '0.9rem',
            fontFamily: 'inherit',
          }}
        >
          <option value="">All campaigns</option>
          {campaigns.map((campaign) => (
            <option key={campaign.id} value={campaign.id}>
              {campaign.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          style={{
            padding: '0.4rem 0.9rem',
            background: '#fff',
            color: '#374151',
            border: '1px solid #d1d5db',
            borderRadius: 4,
            fontSize: '0.9rem',
            cursor: 'pointer',
          }}
        >
          Apply
        </button>
      </form>

      <DiallerRun queue={queue} />
    </main>
  );
}
