'use server';

/**
 * Phase 5 email Server Actions (PHASE_5_SPEC §10). The manual "Run sender now" /
 * "Scan inbox now" triggers, plus sequence enrolment, the campaign↔sequence
 * link, and suppression management. They build the Supabase-backed deps from the
 * caller's RLS-scoped session and delegate to the runner/scanner cores; status /
 * touchpoint / suppression effects are composed in the EmailStore (which reuses
 * the Phase-3 status-precedence rule). Validation via zod; affected routes
 * revalidated after success.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { and, asc, eq, isNotNull, notInArray, sql } from 'drizzle-orm';
import { withRls, type DrizzleTx } from '@/lib/db/rls';
import { rlsCtxFromSession, requireSession } from '@/lib/auth/session';
import { getCurrentOrgId, getCurrentUser } from '@/lib/auth/org';
import { campaigns, contacts, sequenceSteps, suppressions } from '@/lib/db/schema';
import { delegatedGraphToken } from '@/lib/graph/token';
import { getOrgSettings, getUserSettings } from '@/lib/db/queries';
import { getEmailDriver } from '@/lib/email/index';
import { drizzleEmailStore } from '@/lib/email/store';
import { runSender, type RunSenderResult } from '@/lib/email/runner';
import { scanInbox, type ScanInboxResult } from '@/lib/email/scanner';
import { getUnsubscribeConfig } from '@/lib/email/unsubscribe';
import { EmailDriverError } from '@/lib/email/types';
import { businessDayAdd } from '@/lib/email/schedule';
import { buildSimulatedReply, buildSimulatedBounce } from '@/lib/email/mock';
import { pushDevInbound } from '@/lib/email/dev-inbox';
import { escapeLike } from '@/lib/supabase/like';
import { isEmailMockEnabled } from '@/lib/env';
import type { SuppressionReason } from '@/lib/email/types';
import type { OrgSettings } from '@/lib/types/domain';

/** Run `fn` in a transaction scoped to the current authenticated session. */
async function withSession<T>(fn: (tx: DrizzleTx) => Promise<T>): Promise<T> {
  return withRls(rlsCtxFromSession(await requireSession()), fn);
}

const uuid = z.string().uuid();

/** Today as YYYY-MM-DD (UTC). */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function buildContext() {
  // Identity comes from the Auth.js session. getCurrentUser throws if
  // unauthenticated, so `user` is always real.
  const user = await getCurrentUser();
  const orgId = user.orgId;
  // Manual sends render with the SIGNED-IN USER's signature (a per-user-tier
  // setting), falling back to any org-level signature for users who haven't set
  // one. Everything else (sender mailbox, weekend rule, cap) stays org-scoped.
  const orgSettings = await getOrgSettings();
  const userSettings = await getUserSettings();
  const settings: OrgSettings = {
    ...orgSettings,
    ...(userSettings.signature !== undefined ? { signature: userSettings.signature } : {}),
  };

  // Manual (per-user) path: bind the Graph driver to the SIGNED-IN USER'S
  // delegated token (their Entra session's Graph access token, captured at login
  // and surfaced via lib/graph/token.ts), NOT the cron's shared
  // GRAPH_ACCESS_TOKEN — otherwise every org/user would send from one mailbox
  // and inbound would apply to the wrong tenant. mock/mailpit need no token. Fail
  // clearly (don't fall back to the shared token) if the delegated token is
  // absent — the user must have signed in with the Mail scopes
  // (Mail.Send/Mail.Read; requested at login).
  // INTERIM (Phase 4 adds refresh): no refresh-on-expiry yet; an expired token
  // surfaces downstream as GRAPH_UNAUTHORIZED → the re-auth prompt.
  const driverName = process.env.EMAIL_DRIVER;
  const isGraph = driverName === 'graph-dev' || driverName === 'graph-prod';
  let accessToken: string | undefined;
  if (isGraph) {
    accessToken = (await delegatedGraphToken()) ?? undefined;
    if (!accessToken) {
      throw new Error(
        'Manual email send/scan with the Graph driver needs your delegated Microsoft token ' +
          '(Mail.Send / Mail.Read). Re-authenticate with those scopes, or use the scheduled cron.',
      );
    }
    if (!user?.email) {
      throw new Error('Manual Graph send/scan: the signed-in user has no email address.');
    }
  }
  const driver = getEmailDriver(accessToken ? { accessToken } : {});
  // Bind the store to the caller's RLS session; each method runs its own short
  // transaction (SET LOCAL GUCs never leak between calls).
  const store = drizzleEmailStore((fn) => withSession(fn), {
    orgId,
    provider: driver.name,
    settings,
  });
  // The mailbox this manual run actually USES (sends as / scans). For Graph the
  // delegated token is `/me` = the SIGNED-IN USER's mailbox, so it must be the
  // user's address — NOT settings.senderEmail (the org's shared sender). Keying
  // the scan cursor or 'from' to senderEmail while the driver reads the user's
  // inbox would mismatch the cursor and the mailbox. For mock/mailpit there's one
  // local mailbox, so the org sender (then user) is the stable key.
  const from = isGraph ? (user?.email ?? '') : (settings.senderEmail ?? user?.email ?? 'noreply@local');
  return { orgId, settings, driver, store, from };
}

const runSenderSchema = z.object({ dryRun: z.boolean().optional(), limit: z.number().int().positive().optional() });
export type RunSenderNowInput = z.input<typeof runSenderSchema>;

const REAUTH_MESSAGE =
  'Your Microsoft sign-in has expired or email access was revoked. Sign out and sign back in to ' +
  're-grant email access (Mail.Send / Mail.Read), then try again.';

/**
 * Unsubscribe config for sends, with a loud production warning when it's unset —
 * sending commercial mail with no opt-out is a compliance exposure, so make a
 * missing APP_BASE_URL/UNSUBSCRIBE_SECRET visible rather than silently degrading.
 */
function resolveUnsubscribe() {
  const cfg = getUnsubscribeConfig();
  if (!cfg && process.env.NODE_ENV === 'production') {
    console.warn(
      'runSenderNow: APP_BASE_URL/UNSUBSCRIBE_SECRET unset — outbound mail has NO unsubscribe ' +
        'link or List-Unsubscribe header (compliance risk). Set both in the deployment env.',
    );
  }
  return cfg;
}

export async function runSenderNow(input: RunSenderNowInput = {}): Promise<RunSenderResult> {
  const opts = runSenderSchema.parse(input);
  const { settings, driver, store, from } = await buildContext();
  const result = await runSender(
    { store, driver, settings, from, unsubscribe: resolveUnsubscribe(), now: () => new Date().toISOString() },
    { today: todayUtc(), ...(opts.dryRun !== undefined ? { dryRun: opts.dryRun } : {}), ...(opts.limit !== undefined ? { limit: opts.limit } : {}) },
  );
  // An expired delegated token fails sends with GRAPH_UNAUTHORIZED. Only hard-fail
  // with the re-auth prompt when NOTHING succeeded — if some sends landed before
  // the token expired they're already persisted, so keep them (revalidate + return)
  // and let result.errors carry the auth failure rather than discarding real sends.
  if (result.errors.some((e) => e.code === 'GRAPH_UNAUTHORIZED') && result.sent === 0) {
    throw new Error(REAUTH_MESSAGE);
  }
  if (!opts.dryRun) {
    revalidatePath('/queue');
    revalidatePath('/today');
    revalidatePath('/pipeline');
  }
  return result;
}

export async function scanInboxNow(): Promise<ScanInboxResult> {
  const { orgId, driver, store, from } = await buildContext();
  let result: ScanInboxResult;
  try {
    result = await scanInbox({ store, driver, orgId, mailbox: from }, {});
  } catch (cause) {
    // A fetchReplies 401 means the delegated token expired — prompt re-auth.
    if (cause instanceof EmailDriverError && cause.code === 'GRAPH_UNAUTHORIZED') {
      throw new Error(REAUTH_MESSAGE);
    }
    throw cause;
  }
  revalidatePath('/queue');
  revalidatePath('/pipeline');
  return result;
}

/** Link a campaign to a sequence (the cadence the runner walks). */
export async function setCampaignSequence(campaignId: string, sequenceId: string | null): Promise<void> {
  const id = uuid.parse(campaignId);
  const seqId = sequenceId === null ? null : uuid.parse(sequenceId);
  // Require a returned row: an UPDATE that matches nothing (stale/unknown id, or
  // a campaign not visible under RLS) is not an error, so without this the UI
  // would falsely report "Linked campaign to sequence" while nothing changed.
  // RLS scopes the update to the caller's org (target by id only).
  const rows = await withSession((tx) =>
    tx.update(campaigns).set({ sequenceId: seqId }).where(eq(campaigns.id, id)).returning({ id: campaigns.id }),
  );
  if (rows.length === 0) {
    throw new Error('setCampaignSequence: campaign not found (or not in your org).');
  }
  revalidatePath('/campaigns');
  revalidatePath('/sequences');
}

/**
 * Enrol every contact in a campaign into its linked sequence: set each to the
 * sequence's first step and make them due today (PHASE_5_SPEC §4.2). No-op for a
 * campaign with no linked sequence.
 */
export async function enrolInSequence(campaignId: string): Promise<{ enrolled: number }> {
  const id = uuid.parse(campaignId);
  const orgId = await getCurrentOrgId();
  const settings = await getOrgSettings();

  return withSession(async (tx) => {
    const [campaign] = await tx
      .select({ sequenceId: campaigns.sequenceId })
      .from(campaigns)
      .where(eq(campaigns.id, id))
      .limit(1);
    if (!campaign) throw new Error('enrolInSequence: campaign not found (or not in your org).');
    const sequenceId = campaign.sequenceId;
    if (!sequenceId) throw new Error('enrolInSequence: campaign has no linked sequence');

    // Enrol at the first EMAIL step (not the lowest step overall): the email
    // runner only processes channel='email' steps, so starting a contact on a
    // leading phone/LinkedIn step would strand them — they'd never enter the
    // email queue.
    const [step] = await tx
      .select({ dayOffset: sequenceSteps.dayOffset })
      .from(sequenceSteps)
      .where(and(eq(sequenceSteps.sequenceId, sequenceId), eq(sequenceSteps.channel, 'email')))
      .orderBy(asc(sequenceSteps.dayOffset))
      .limit(1);
    const firstDayOffset = step?.dayOffset;
    if (firstDayOffset === undefined) throw new Error('enrolInSequence: sequence has no email steps');

    const today = businessDayAdd(todayUtc(), 0, settings.seqSkipWeekends ?? true);
    const updated = await tx
      .update(contacts)
      .set({ sequenceDay: firstDayOffset, followUp: today })
      .where(
        and(
          eq(contacts.orgId, orgId),
          eq(contacts.campaignId, id),
          isNotNull(contacts.email),
          // Don't resurface contacts in a terminal state (matches the runner's
          // dueContacts filter): enrolling a campaign must not reset follow_up
          // for someone who booked a meeting, isn't interested, or hard-bounced.
          notInArray(contacts.status, ['notinterested', 'bounced', 'meeting']),
        ),
      )
      .returning({ id: contacts.id });

    revalidatePath('/queue');
    revalidatePath('/pipeline');
    return { enrolled: updated.length };
  });
}

const suppressionReasons: SuppressionReason[] = ['replied', 'bounced', 'manual', 'unsubscribed'];
const addSuppressionSchema = z.object({
  email: z.string().trim().email(),
  reason: z.enum(suppressionReasons as [SuppressionReason, ...SuppressionReason[]]).default('manual'),
});
export type AddSuppressionInput = z.input<typeof addSuppressionSchema>;

export async function addSuppression(input: AddSuppressionInput): Promise<void> {
  const parsed = addSuppressionSchema.parse(input);
  const orgId = await getCurrentOrgId();
  // ON CONFLICT (org_id,email) DO NOTHING — re-suppressing is idempotent.
  await withSession((tx) =>
    tx
      .insert(suppressions)
      // suppressions.createdAt is NOT NULL with a DB-side `default now()`; the
      // schema omits the Drizzle default, so supply it explicitly.
      .values({ orgId, email: parsed.email.toLowerCase(), reason: parsed.reason, createdAt: sql`now()` })
      .onConflictDoNothing({ target: [suppressions.orgId, suppressions.email] }),
  );
  revalidatePath('/suppressions');
}

/** Un-suppress (the legacy "un-skip" path). */
export async function removeSuppression(suppressionId: string): Promise<void> {
  const id = uuid.parse(suppressionId);
  const orgId = await getCurrentOrgId();
  await withSession(async (tx) => {
    const [row] = await tx
      .delete(suppressions)
      .where(eq(suppressions.id, id))
      .returning({ email: suppressions.email, reason: suppressions.reason });

    // A BOUNCE sets BOTH a suppression and status='bounced'; deleting that
    // suppression alone leaves the contact terminal (the runner excludes
    // 'bounced'), so un-suppress would be a no-op for re-enabling sends. Clear
    // the bounce status back to neutral ONLY when the row we just deleted was
    // the bounce suppression — removing a manual/replied/unsubscribed
    // suppression must NOT clear a 'bounced' status the address earned
    // separately. 'notinterested'/'meeting' are deliberate human states and are
    // never touched here. (Match case-insensitively: suppressions.email is
    // normalised, contacts.email may not be.)
    if (row && row.reason === 'bounced') {
      await tx
        .update(contacts)
        .set({ status: 'none' })
        .where(
          and(
            eq(contacts.orgId, orgId),
            eq(contacts.status, 'bounced'),
            sql`${contacts.email} ilike ${escapeLike(row.email)}`,
          ),
        );
    }
  });
  revalidatePath('/suppressions');
}

const simulateSchema = z.object({ email: z.string().trim().email(), kind: z.enum(['reply', 'bounce']) });
export type SimulateInboundInput = z.input<typeof simulateSchema>;

/**
 * Dev-only: enqueue a simulated reply/bounce from a contact into the process
 * dev-inbox, so the next "Scan inbox now" picks it up — exercising the full
 * reply→green→stop / bounce→suppress loop locally without a real mailbox.
 * Hard-gated by isEmailMockEnabled() (PHASE_5_SPEC §9, DECISION 9.1).
 */
export async function simulateInbound(input: SimulateInboundInput): Promise<void> {
  if (!isEmailMockEnabled()) throw new Error('simulateInbound: disabled (not a local mock environment)');
  const { email, kind } = simulateSchema.parse(input);
  // Authorize: a real session must exist (don't let an unauthenticated caller seed).
  await getCurrentOrgId();
  pushDevInbound(kind === 'reply' ? buildSimulatedReply({ from: email }) : buildSimulatedBounce({ recipient: email }));
}
