/**
 * Cron entry points (PHASE_5_SPEC §1): run the sender / scanner for the cron org
 * using the service-role client. Used by the CRON_SECRET-gated routes. Local dev
 * uses the manual Server Actions instead, so this path isn't exercised in CI.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSettings } from '@/lib/types/domain';
import { getServerEnv } from '@/lib/env';
import { getEmailDriver } from '@/lib/email/index';
import { supabaseEmailStore } from '@/lib/email/store';
import { runSender } from '@/lib/email/runner';
import { scanInbox } from '@/lib/email/scanner';

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The org(s) the cron serves. One global email driver = one mailbox/token, so a
 * correct cron must target the SINGLE org that mailbox belongs to: set
 * CRON_ORG_ID per deployment. Without it we return none (refuse to fan a shared
 * mailbox/token across tenants — that would send all orgs from one mailbox and
 * cross-apply one inbound to several orgs). Per-org driver/token construction is
 * the deferred path to true multi-tenant cron.
 */
async function orgs(client: SupabaseClient): Promise<{ id: string; settings: OrgSettings }[]> {
  const cronOrgId = getServerEnv().CRON_ORG_ID;
  if (!cronOrgId) return [];
  const { data, error } = await client.from('organizations').select('id, settings').eq('id', cronOrgId);
  if (error) throw new Error(`cron.orgs: ${error.message}`);
  return (data ?? []).map((o) => ({ id: o.id as string, settings: (o.settings as OrgSettings) ?? {} }));
}

export async function runSenderAllOrgs(client: SupabaseClient): Promise<{ orgs: number; sent: number; skipped: number }> {
  const driver = getEmailDriver();
  const fallbackFrom = getServerEnv().CRON_SENDER_EMAIL;
  let sent = 0;
  let skipped = 0;
  const list = await orgs(client);
  for (const org of list) {
    // A cron send needs a real configured mailbox (settings.signature is a
    // human-readable string, not an address). Prefer the org's senderEmail, else
    // the deploy-wide CRON_SENDER_EMAIL. Skip LOUDLY if neither is set — a silent
    // no-op would look like a healthy run that just sent nothing.
    const from = org.settings.senderEmail ?? fallbackFrom;
    if (!from) {
      skipped += 1;
      console.warn(`cron runSender: org ${org.id} has no senderEmail and CRON_SENDER_EMAIL is unset — skipped`);
      continue;
    }
    const store = supabaseEmailStore(client, { orgId: org.id, provider: driver.name, settings: org.settings });
    const res = await runSender(
      { store, driver, settings: org.settings, from, now: () => new Date().toISOString() },
      { today: todayUtc() },
    );
    sent += res.sent;
  }
  return { orgs: list.length, sent, skipped };
}

export async function scanInboxAllOrgs(
  client: SupabaseClient,
): Promise<{ orgs: number; replies: number; bounces: number; skipped: number }> {
  const driver = getEmailDriver();
  const fallbackFrom = getServerEnv().CRON_SENDER_EMAIL;
  let replies = 0;
  let bounces = 0;
  const list = await orgs(client);
  let scanned = 0;
  let skipped = 0;
  for (const org of list) {
    // Correct multi-org scanning needs a PER-ORG mailbox/token (each org reads
    // its OWN inbox); with a single shared driver mailbox, one inbound could be
    // applied to several orgs. Until per-org token wiring lands (deploy concern,
    // like the sender's senderEmail), only scan a configured org — settings
    // .senderEmail or the deploy-wide CRON_SENDER_EMAIL marks it; the deploy must
    // point the driver at that org's mailbox. Skip LOUDLY if neither is set.
    const mailbox = org.settings.senderEmail ?? fallbackFrom;
    if (!mailbox) {
      skipped += 1;
      console.warn(`cron scanInbox: org ${org.id} has no senderEmail and CRON_SENDER_EMAIL is unset — skipped`);
      continue;
    }
    scanned += 1;
    const store = supabaseEmailStore(client, { orgId: org.id, provider: driver.name, settings: org.settings });
    const res = await scanInbox({ store, driver, orgId: org.id, mailbox }, {});
    replies += res.replies;
    bounces += res.bounces;
  }
  return { orgs: scanned, replies, bounces, skipped };
}
