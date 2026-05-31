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
import { createClient } from '@/lib/supabase/server';
import { getCurrentOrgId } from '@/lib/supabase/org';
import { getOrgSettings } from '@/lib/supabase/queries';
import { getEmailDriver } from '@/lib/email/index';
import { supabaseEmailStore } from '@/lib/email/store';
import { runSender, type RunSenderResult } from '@/lib/email/runner';
import { scanInbox, type ScanInboxResult } from '@/lib/email/scanner';
import { businessDayAdd } from '@/lib/email/schedule';
import { buildSimulatedReply, buildSimulatedBounce } from '@/lib/email/mock';
import { pushDevInbound } from '@/lib/email/dev-inbox';
import { escapeLike } from '@/lib/supabase/like';
import { isEmailMockEnabled } from '@/lib/env';
import type { SuppressionReason } from '@/lib/email/types';

const uuid = z.string().uuid();

/** Today as YYYY-MM-DD (UTC). */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function buildContext() {
  const orgId = await getCurrentOrgId();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const settings = await getOrgSettings();
  const driver = getEmailDriver();
  // Manual (per-user) send/scan must NOT run through the process-wide Graph token
  // (GRAPH_ACCESS_TOKEN): it's one mailbox, so every org/user would send from it
  // and inbound would apply to the wrong tenant. Per-user delegated tokens (from
  // the user's Supabase Azure session) are a deferred fast-follow; until then the
  // Graph driver is for the single-org cron only. Refuse here rather than fan a
  // shared mailbox across tenants. (mock/mailpit are fine for local manual use.)
  if (driver.name === 'graph-dev' || driver.name === 'graph-prod') {
    throw new Error(
      'Manual email send/scan is not supported with the Graph driver yet ' +
        '(per-user delegated token not wired — it would use one shared mailbox for every org). ' +
        'Use the scheduled single-org cron, or the mock/mailpit driver locally.',
    );
  }
  const store = supabaseEmailStore(supabase, { orgId, provider: driver.name, settings });
  // Prefer the configured org mailbox (same as cron), then the signed-in user's
  // address for a delegated send. Never the signature (a human-readable string,
  // not an address). Falls back to a local placeholder only for the mock driver.
  const from = settings.senderEmail ?? user?.email ?? 'noreply@local';
  return { orgId, supabase, settings, driver, store, from };
}

const runSenderSchema = z.object({ dryRun: z.boolean().optional(), limit: z.number().int().positive().optional() });
export type RunSenderNowInput = z.input<typeof runSenderSchema>;

export async function runSenderNow(input: RunSenderNowInput = {}): Promise<RunSenderResult> {
  const opts = runSenderSchema.parse(input);
  const { settings, driver, store, from } = await buildContext();
  const result = await runSender(
    { store, driver, settings, from, now: () => new Date().toISOString() },
    { today: todayUtc(), ...(opts.dryRun !== undefined ? { dryRun: opts.dryRun } : {}), ...(opts.limit !== undefined ? { limit: opts.limit } : {}) },
  );
  if (!opts.dryRun) {
    revalidatePath('/queue');
    revalidatePath('/today');
    revalidatePath('/pipeline');
  }
  return result;
}

export async function scanInboxNow(): Promise<ScanInboxResult> {
  const { orgId, driver, store } = await buildContext();
  const result = await scanInbox({ store, driver, orgId }, {});
  revalidatePath('/queue');
  revalidatePath('/pipeline');
  return result;
}

/** Link a campaign to a sequence (the cadence the runner walks). */
export async function setCampaignSequence(campaignId: string, sequenceId: string | null): Promise<void> {
  const id = uuid.parse(campaignId);
  const seqId = sequenceId === null ? null : uuid.parse(sequenceId);
  const supabase = await createClient();
  const { error } = await supabase.from('campaigns').update({ sequence_id: seqId }).eq('id', id);
  if (error) throw new Error(`setCampaignSequence: ${error.message}`);
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
  const supabase = await createClient();
  const settings = await getOrgSettings();

  const { data: campaign, error: cErr } = await supabase
    .from('campaigns')
    .select('sequence_id')
    .eq('id', id)
    .single();
  if (cErr) throw new Error(`enrolInSequence: ${cErr.message}`);
  const sequenceId = (campaign as { sequence_id: string | null }).sequence_id;
  if (!sequenceId) throw new Error('enrolInSequence: campaign has no linked sequence');

  // Enrol at the first EMAIL step (not the lowest step overall): the email runner
  // only processes channel='email' steps, so starting a contact on a leading
  // phone/LinkedIn step would strand them — they'd never enter the email queue.
  const { data: steps, error: sErr } = await supabase
    .from('sequence_steps')
    .select('day_offset')
    .eq('sequence_id', sequenceId)
    .eq('channel', 'email')
    .order('day_offset', { ascending: true })
    .limit(1);
  if (sErr) throw new Error(`enrolInSequence: ${sErr.message}`);
  const firstDayOffset = (steps?.[0] as { day_offset: number } | undefined)?.day_offset;
  if (firstDayOffset === undefined) throw new Error('enrolInSequence: sequence has no email steps');

  const today = businessDayAdd(todayUtc(), 0, settings.seqSkipWeekends ?? true);
  const { data: updated, error: uErr } = await supabase
    .from('contacts')
    .update({ sequence_day: firstDayOffset, follow_up: today })
    .eq('org_id', orgId)
    .eq('campaign_id', id)
    .not('email', 'is', null)
    // Don't resurface contacts in a terminal state (matches the runner's
    // dueContacts filter): enrolling a campaign must not reset follow_up for
    // someone who booked a meeting, isn't interested, or hard-bounced.
    .not('status', 'in', '(notinterested,bounced,meeting)')
    .select('id');
  if (uErr) throw new Error(`enrolInSequence: ${uErr.message}`);

  revalidatePath('/queue');
  revalidatePath('/pipeline');
  return { enrolled: updated?.length ?? 0 };
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
  const supabase = await createClient();
  const { error } = await supabase
    .from('suppressions')
    .upsert(
      { org_id: orgId, email: parsed.email.toLowerCase(), reason: parsed.reason },
      { onConflict: 'org_id,email', ignoreDuplicates: true },
    );
  if (error) throw new Error(`addSuppression: ${error.message}`);
  revalidatePath('/suppressions');
}

/** Un-suppress (the legacy "un-skip" path). */
export async function removeSuppression(suppressionId: string): Promise<void> {
  const id = uuid.parse(suppressionId);
  const orgId = await getCurrentOrgId();
  const supabase = await createClient();
  const { data: deleted, error } = await supabase
    .from('suppressions')
    .delete()
    .eq('id', id)
    .select('email')
    .maybeSingle();
  if (error) throw new Error(`removeSuppression: ${error.message}`);

  // A bounce sets BOTH a suppression and status='bounced'; deleting the
  // suppression alone leaves the contact terminal (the runner excludes
  // 'bounced'), so un-suppress would be a no-op for re-enabling sends. Clear that
  // bounce status back to neutral so the contact can be re-queued. Only 'bounced'
  // is reset — 'notinterested'/'meeting' are deliberate human states, untouched.
  // (suppressions.email is normalised lower+trim; contacts.email may be mixed
  // case, so match case-insensitively with LIKE wildcards escaped.)
  const email = (deleted as { email: string } | null)?.email;
  if (email) {
    const { error: statusErr } = await supabase
      .from('contacts')
      .update({ status: 'none' })
      .eq('org_id', orgId)
      .eq('status', 'bounced')
      .ilike('email', escapeLike(email));
    if (statusErr) throw new Error(`removeSuppression.status: ${statusErr.message}`);
  }
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
