/**
 * Cron entry points (PHASE_5_SPEC §1): run the sender / scanner across every org
 * using the service-role client. Used by the CRON_SECRET-gated routes. Local dev
 * uses the manual Server Actions instead, so this path isn't exercised in CI.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSettings } from '@/lib/types/domain';
import { getEmailDriver } from '@/lib/email/index';
import { supabaseEmailStore } from '@/lib/email/store';
import { runSender } from '@/lib/email/runner';
import { scanInbox } from '@/lib/email/scanner';

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function orgs(client: SupabaseClient): Promise<{ id: string; settings: OrgSettings }[]> {
  const { data, error } = await client.from('organizations').select('id, settings');
  if (error) throw new Error(`cron.orgs: ${error.message}`);
  return (data ?? []).map((o) => ({ id: o.id as string, settings: (o.settings as OrgSettings) ?? {} }));
}

export async function runSenderAllOrgs(client: SupabaseClient): Promise<{ orgs: number; sent: number }> {
  const driver = getEmailDriver();
  let sent = 0;
  const list = await orgs(client);
  for (const org of list) {
    // Fail closed: a cron send needs a real configured mailbox (settings.signature
    // is a human-readable string, not an address). Skip orgs without one.
    const from = org.settings.senderEmail;
    if (!from) continue;
    const store = supabaseEmailStore(client, { orgId: org.id, provider: driver.name, settings: org.settings });
    const res = await runSender(
      { store, driver, settings: org.settings, from, now: () => new Date().toISOString() },
      { today: todayUtc() },
    );
    sent += res.sent;
  }
  return { orgs: list.length, sent };
}

export async function scanInboxAllOrgs(client: SupabaseClient): Promise<{ orgs: number; replies: number; bounces: number }> {
  const driver = getEmailDriver();
  let replies = 0;
  let bounces = 0;
  const list = await orgs(client);
  let scanned = 0;
  for (const org of list) {
    // Correct multi-org scanning needs a PER-ORG mailbox/token (each org reads
    // its OWN inbox); with a single shared driver mailbox, one inbound could be
    // applied to several orgs. Until per-org token wiring lands (deploy concern,
    // like the sender's senderEmail), only scan orgs that have a configured
    // mailbox — and the deploy must point the driver at that org's mailbox.
    if (!org.settings.senderEmail) continue;
    scanned += 1;
    const store = supabaseEmailStore(client, { orgId: org.id, provider: driver.name, settings: org.settings });
    const res = await scanInbox({ store, driver, orgId: org.id }, {});
    replies += res.replies;
    bounces += res.bounces;
  }
  return { orgs: scanned, replies, bounces };
}
