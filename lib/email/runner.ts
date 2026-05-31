/**
 * Send runner (PHASE_5_SPEC §5). Orchestrates over an injected {@link EmailStore}
 * + {@link EmailDriver}, so it's unit-testable with fakes. For each due contact
 * it renders the step template, sends, and records the send + sequence advance.
 *
 * Behaviour: weekend no-op (when seqSkipWeekends), daily-cap accounting with a
 * surfaced remainder (no silent truncation), per-contact error isolation (one
 * bad address never aborts the batch and doesn't advance that contact), and a
 * dry-run that plans without sending/writing. `now`/`today` are injected.
 */
import type { EmailDriver } from '@/lib/email/driver';
import type { OutboundMessage } from '@/lib/email/types';
import type { DueContact, EmailStore } from '@/lib/email/store';
import { renderTemplate } from '@/lib/email/render';
import { businessDayAdd } from '@/lib/email/schedule';
import type { OrgSettings } from '@/lib/types/domain';

const DEFAULT_DAILY_GOAL = 30;
// Fetch a few more than the cap so a per-contact send/template failure (which
// doesn't consume a cap slot) can be backfilled from the next candidate instead
// of under-sending. Bounded + small; the `processed >= cap` guard still caps.
const SEND_BUFFER = 10;

/** Escape HTML so rendered template/contact text can't alter the email markup. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface RunSenderDeps {
  store: EmailStore;
  driver: EmailDriver;
  settings: OrgSettings;
  /** Sending mailbox (the authenticated user's / org address). */
  from: string;
  now(): string;
}

export interface RunSenderOptions {
  today: string; // YYYY-MM-DD
  dryRun?: boolean;
  limit?: number;
}

export interface PlannedSend {
  contactId: string;
  to: string;
  subject: string;
}

export interface RunSenderResult {
  planned: PlannedSend[];
  sent: number;
  skipped: number;
  /** `persisted: false` flags a sent-but-not-recorded message (transport ok, DB write failed). */
  errors: { contactId: string; message: string; persisted?: boolean }[];
  /** Eligible contacts left unsent because the daily cap was exhausted. */
  remaining: number;
}

function isWeekend(today: string): boolean {
  const dow = new Date(`${today}T00:00:00.000Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

/** Most-overdue first, then earliest sequence step (DECISION 5.1). */
function order(a: DueContact, b: DueContact): number {
  const fa = a.contact.followUp ?? '';
  const fb = b.contact.followUp ?? '';
  if (fa !== fb) return fa < fb ? -1 : 1;
  return a.sequenceDay - b.sequenceDay;
}

export async function runSender(deps: RunSenderDeps, opts: RunSenderOptions): Promise<RunSenderResult> {
  const empty: RunSenderResult = { planned: [], sent: 0, skipped: 0, errors: [], remaining: 0 };
  const skipWeekends = deps.settings.seqSkipWeekends ?? true;
  if (skipWeekends && isWeekend(opts.today)) return empty;

  const dailyGoal = deps.settings.dailyGoal ?? DEFAULT_DAILY_GOAL;
  const sentToday = await deps.store.sentCountToday(opts.today);
  // Daily-goal headroom first, THEN clamp by the optional per-run limit — so a
  // small `limit` caps this run without spuriously zeroing the cap once some
  // sends already happened today (e.g. goal 30, sentToday 28, limit 5 → 2, not 0).
  const dailyRemaining = Math.max(0, dailyGoal - sentToday);
  const cap = Math.min(opts.limit ?? Number.POSITIVE_INFINITY, dailyRemaining);

  // Fetch only up to the cap (+ a small buffer to absorb per-contact failures),
  // most-overdue first, and report the rest via a cheap accurate count — so a
  // large backlog isn't materialised to send a small batch. `remaining` is
  // cap-relative ("eligible due beyond what this run can send"), so it's correct
  // for dry runs and the 0/∞ cap too.
  const fetchLimit = Number.isFinite(cap) ? (cap > 0 ? cap + SEND_BUFFER : 0) : undefined;
  const dueAll = (await deps.store.dueContacts(opts.today, fetchLimit)).slice().sort(order);
  const dueTotal = await deps.store.countDue(opts.today);

  const result: RunSenderResult = { planned: [], sent: 0, skipped: 0, errors: [], remaining: 0 };
  let processed = 0;

  for (const item of dueAll) {
    // Defensive: the fetch is already bounded to the cap, but a fake/over-fetch
    // could return more — never send past the cap.
    if (processed >= cap) break;
    const { contact, sequenceDay, nextDayOffset, template } = item;
    if (!contact.email) {
      result.skipped += 1;
      continue;
    }
    // A step with no linked template would render an empty subject/body — skip
    // and surface it rather than send blank mail (templateId is nullable).
    if (!template) {
      result.skipped += 1;
      result.errors.push({ contactId: contact.id, message: 'skipped: sequence step has no template' });
      continue;
    }
    const rendered = renderTemplate(template, contact, deps.settings);
    result.planned.push({ contactId: contact.id, to: contact.email, subject: rendered.subject });

    if (opts.dryRun) {
      processed += 1;
      continue;
    }

    // Atomically claim the contact BEFORE sending: a concurrent run (cron +
    // manual, or overlapping ticks) could have fetched the same due row, and the
    // per-send message id won't let email_events dedupe a double-send. The loser
    // of the claim skips silently — the winner sends. The claim returns the
    // contact's CURRENT email — send to THAT, not the pre-claim snapshot, so an
    // address edited between dueContacts() and now is honoured (no stale send).
    const claimNow = deps.now();
    const claimedEmail = await deps.store.claimForSend(contact.id, opts.today, claimNow, dailyGoal);
    if (!claimedEmail) {
      continue;
    }

    const message: OutboundMessage = {
      from: deps.from,
      to: [claimedEmail],
      subject: rendered.subject,
      bodyText: rendered.body,
      bodyHtml: escapeHtml(rendered.body).replace(/\n/g, '<br>'),
    };

    // Transport failure: nothing left the building — RELEASE the claim so the
    // contact retries today and isn't counted toward the cap (the claim marked
    // last_emailed_at; undo it back to the pre-claim value). A persistence
    // failure below is different: the send DID happen, so the claim stays.
    let ref;
    try {
      ref = await deps.driver.send(message);
    } catch (cause) {
      try {
        await deps.store.releaseClaim(contact.id, claimNow, contact.lastEmailedAt);
      } catch {
        // Best-effort: if the release fails, the contact stays claimed and simply
        // retries on the next day's run rather than today — never double-sent.
      }
      result.errors.push({
        contactId: contact.id,
        message: `send: ${cause instanceof Error ? cause.message : 'failed'}`,
        persisted: false,
      });
      continue;
    }

    // The email is OUT — it consumed a daily-cap slot regardless of whether the
    // DB write below succeeds (so a persistence retry can't exceed the goal).
    processed += 1;

    try {
      const nextFollowUp =
        nextDayOffset !== null ? businessDayAdd(opts.today, nextDayOffset - sequenceDay, skipWeekends) : null;
      await deps.store.recordSent({
        orgId: contact.orgId,
        contact,
        campaignId: item.campaignId,
        recipient: claimedEmail,
        ref,
        subject: rendered.subject,
        sequenceDay,
        nextSequenceDay: nextDayOffset,
        nextFollowUp,
        now: claimNow,
      });
      result.sent += 1;
    } catch (cause) {
      // Persistence failed AFTER a successful external send: flagged distinctly
      // (persisted:false). recordSent IS a single transactional RPC (advance +
      // email_events + touchpoint), so this only happens if the DB is unreachable
      // at that instant. The contact wasn't advanced, so a later run re-sends
      // (at-least-once — unavoidable for non-transactional email).
      //
      // KNOWN DEFERRED GAP: until that retry persists the email_events(sent) row,
      // the scanner's sender-fallback correlation (which requires a prior sent
      // event) will ignore a reply/bounce that arrives IN THIS WINDOW, and the
      // scan cursor can advance past it — losing that stop/suppression. Closing
      // it needs a durable transactional outbox for sends (or a scanner fallback
      // that correlates against the claimed last_emailed_at state until the sent
      // event is recovered); both are a fast-follow beyond this mocked phase.
      result.errors.push({
        contactId: contact.id,
        message: `recordSent: ${cause instanceof Error ? cause.message : 'failed'}`,
        persisted: false,
      });
    }
  }

  // Eligible due contacts beyond what this run could send (cap-relative; 0 when
  // the cap is unbounded). dueTotal is an upper estimate (pre suppression), so
  // floor at 0.
  result.remaining = Math.max(0, dueTotal - cap);

  return result;
}
