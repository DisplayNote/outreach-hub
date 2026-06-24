/**
 * Cron entry points (PHASE_5_SPEC §1): run the sender / scanner for the cron org
 * using the service-role client. Used by the CRON_SECRET-gated routes. Local dev
 * uses the manual Server Actions instead, so this path isn't exercised in CI.
 */
import { eq } from 'drizzle-orm';
import type { OrgSettings } from '@/lib/types/domain';
import { getServerEnv } from '@/lib/env';
import { withServiceRls } from '@/lib/db/rls-service';
import type { DrizzleTx } from '@/lib/db/rls';
import { organizations } from '@/lib/db/schema';
import { getEmailDriver } from '@/lib/email/index';
import { appOnlyGraphToken } from '@/lib/graph/token';
import { drizzleEmailStore } from '@/lib/email/store';
import { runSender } from '@/lib/email/runner';
import { scanInbox } from '@/lib/email/scanner';
import { getUnsubscribeConfig } from '@/lib/email/unsubscribe';

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
async function orgs(): Promise<{ id: string; settings: OrgSettings }[]> {
  const cronOrgId = getServerEnv().CRON_ORG_ID;
  const isProd = process.env.NODE_ENV === 'production';
  if (!cronOrgId) {
    // Fail LOUDLY in production: an unset CRON_ORG_ID makes the scheduled routes a
    // no-op that returns { ok: true, orgs: 0 } and looks healthy to monitoring.
    // Locally the cron isn't used (manual path), so a no-op is fine.
    if (isProd) {
      throw new Error(
        'cron: CRON_ORG_ID is not set — refusing a no-op scheduled run in production. ' +
          'Set it to the org whose mailbox the configured email driver serves.',
      );
    }
    return [];
  }
  // CRON_ORG_ID is trusted (deploy env), so withServiceRls scopes the org read.
  const data = await withServiceRls(cronOrgId, (tx) =>
    tx
      .select({ id: organizations.id, settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, cronOrgId)),
  );
  const list = data.map((o) => ({ id: o.id, settings: (o.settings as OrgSettings) ?? {} }));
  // CRON_ORG_ID set but matching no row is also a misconfiguration — fail loudly in prod.
  if (list.length === 0 && isProd) {
    throw new Error(`cron: CRON_ORG_ID ${cronOrgId} matches no organization — misconfiguration.`);
  }
  return list;
}

/**
 * Build the cron's EmailDriver. For the Graph drivers the unattended cron has no
 * signed-in user, so it acquires an APPLICATION (client-credentials) Graph token
 * for the configured mailbox; mock/mailpit need no token.
 */
async function cronDriver(mailbox: string) {
  const name = process.env.EMAIL_DRIVER;
  if (name === 'graph-dev' || name === 'graph-prod') {
    // The app-only (client-credentials) token has NO user context, so the driver
    // must address this org's mailbox via /users/{mailbox} — not /me. The token
    // is cached in-module, so calling per-org is cheap.
    return getEmailDriver({ accessToken: await appOnlyGraphToken(), mailbox });
  }
  return getEmailDriver();
}

/** Build a Drizzle store bound to a single org via withServiceRls. */
function storeFor(orgId: string, provider: string, settings: OrgSettings) {
  const runTx = <T,>(fn: (tx: DrizzleTx) => Promise<T>): Promise<T> => withServiceRls(orgId, fn);
  return drizzleEmailStore(runTx, { orgId, provider, settings });
}

export async function runSenderAllOrgs(): Promise<{
  orgs: number;
  sent: number;
  skipped: number;
  errors: number;
}> {
  const fallbackFrom = getServerEnv().CRON_SENDER_EMAIL;
  const unsubscribe = getUnsubscribeConfig();
  if (!unsubscribe && process.env.NODE_ENV === 'production') {
    console.warn(
      'cron runSender: APP_BASE_URL/UNSUBSCRIBE_SECRET unset — outbound mail has NO unsubscribe ' +
        'link or List-Unsubscribe header (compliance risk). Set both in the deployment env.',
    );
  }
  let sent = 0;
  let skipped = 0;
  let errors = 0;
  const list = await orgs();
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
    const driver = await cronDriver(from);
    const store = storeFor(org.id, driver.name, org.settings);
    const res = await runSender(
      { store, driver, settings: org.settings, from, unsubscribe, now: () => new Date().toISOString() },
      { today: todayUtc() },
    );
    sent += res.sent;
    // Surface per-contact send/persistence failures: dropping them lets a fully
    // failing scheduled run report { ok: true, sent: 0 } with nothing for
    // monitoring to alert on. Aggregate the count (and log it when non-zero).
    if (res.errors.length > 0) {
      errors += res.errors.length;
      console.warn(`cron runSender: org ${org.id} had ${res.errors.length} send error(s)`);
    }
  }
  return { orgs: list.length, sent, skipped, errors };
}

export async function scanInboxAllOrgs(): Promise<{
  orgs: number;
  replies: number;
  bounces: number;
  skipped: number;
}> {
  const fallbackFrom = getServerEnv().CRON_SENDER_EMAIL;
  let replies = 0;
  let bounces = 0;
  const list = await orgs();
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
    const driver = await cronDriver(mailbox);
    const store = storeFor(org.id, driver.name, org.settings);
    const res = await scanInbox({ store, driver, orgId: org.id, mailbox }, {});
    replies += res.replies;
    bounces += res.bounces;
  }
  return { orgs: scanned, replies, bounces, skipped };
}
