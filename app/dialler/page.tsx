import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import {
  getOrgSettings,
  getTodayContacts,
  getUserSettings,
  listCampaigns,
} from '@/lib/supabase/queries';
import { pickDialNumber } from '@/lib/dialler/normalise';
import { resolveDiallerPrefs } from '@/lib/dialler/prefs';
import type { Contact } from '@/lib/types/domain';
import { Button, Card, Field, Icon } from '@/components/ui';
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

  const [dueContacts, campaigns, settings, userSettings] = await Promise.all([
    getTodayContacts(),
    listCampaigns(),
    getOrgSettings(),
    getUserSettings(),
  ]);

  const defaultCountryCode = settings.defaultCountryCode ?? '+44';
  const diallerPrefs = resolveDiallerPrefs(userSettings);

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
    <div className="content__inner">
      <div className="page-head">
        <div>
          <div className="page-head__title">Dialler</div>
          <div className="page-head__sub">Work through your due calls one contact at a time.</div>
        </div>
        <div className="page-actions">
          <Link href="/dialler/amd" className="btn btn--secondary btn--md">
            <Icon name="voicemail" size={16} />
            <span>Start an AMD run</span>
          </Link>
        </div>
      </div>

      {/* Campaign filter — a plain GET form so it works without client JS. */}
      <Card bodyStyle={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-5)', alignItems: 'flex-end' }}>
        <form method="get" className="row gap-5" style={{ alignItems: 'flex-end' }}>
          <div style={{ minWidth: 220 }}>
            <Field label="Campaign" htmlFor="campaign">
              <select id="campaign" name="campaign" className="input" defaultValue={campaignFilter ?? ''}>
                <option value="">All campaigns</option>
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Button type="submit" variant="secondary" icon="search">
            Apply
          </Button>
        </form>
      </Card>

      <div style={{ marginTop: 'var(--space-6)' }}>
        <DiallerRun
          queue={queue}
          autoDial={diallerPrefs.autoDial}
          interCallDelaySec={diallerPrefs.interCallDelaySec}
          synthTones={diallerPrefs.synthTones}
        />
      </div>
    </div>
  );
}
