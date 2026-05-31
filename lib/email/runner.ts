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
import { businessDayAdd, nextStep } from '@/lib/email/schedule';
import type { OrgSettings } from '@/lib/types/domain';

const DEFAULT_DAILY_GOAL = 30;

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
  return a.step.dayOffset - b.step.dayOffset;
}

export async function runSender(deps: RunSenderDeps, opts: RunSenderOptions): Promise<RunSenderResult> {
  const empty: RunSenderResult = { planned: [], sent: 0, skipped: 0, errors: [], remaining: 0 };
  const skipWeekends = deps.settings.seqSkipWeekends ?? true;
  if (skipWeekends && isWeekend(opts.today)) return empty;

  const dailyGoal = deps.settings.dailyGoal ?? DEFAULT_DAILY_GOAL;
  const sentToday = await deps.store.sentCountToday(opts.today);
  const cap = Math.max(0, Math.min(opts.limit ?? Number.POSITIVE_INFINITY, dailyGoal) - sentToday);

  const dueAll = (await deps.store.dueContacts(opts.today)).slice().sort(order);

  const result: RunSenderResult = { planned: [], sent: 0, skipped: 0, errors: [], remaining: 0 };
  let processed = 0;

  for (const item of dueAll) {
    if (processed >= cap) {
      result.remaining += 1;
      continue;
    }
    const { contact, step, steps, template } = item;
    if (!contact.email) {
      result.skipped += 1;
      continue;
    }
    const rendered = renderTemplate(template ?? { subject: null, body: null }, contact, deps.settings);
    result.planned.push({ contactId: contact.id, to: contact.email, subject: rendered.subject });

    if (opts.dryRun) {
      processed += 1;
      continue;
    }

    const message: OutboundMessage = {
      from: deps.from,
      to: [contact.email],
      subject: rendered.subject,
      bodyText: rendered.body,
      bodyHtml: escapeHtml(rendered.body).replace(/\n/g, '<br>'),
    };

    // Transport failure: nothing was sent — don't consume a cap slot, just record.
    let ref;
    try {
      ref = await deps.driver.send(message);
    } catch (cause) {
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
      const next = nextStep(steps, step.dayOffset);
      const nextFollowUp = next
        ? businessDayAdd(opts.today, next.dayOffset - step.dayOffset, skipWeekends)
        : null;
      await deps.store.recordSent({
        orgId: contact.orgId,
        contact,
        campaignId: item.campaignId,
        ref,
        subject: rendered.subject,
        sequenceDay: step.dayOffset,
        nextSequenceDay: next ? next.dayOffset : null,
        nextFollowUp,
        now: deps.now(),
      });
      result.sent += 1;
    } catch (cause) {
      // Persistence failed AFTER a successful external send: flagged distinctly
      // (persisted:false). The contact wasn't advanced, so a later run may
      // re-send — the unavoidable at-least-once for non-transactional email.
      result.errors.push({
        contactId: contact.id,
        message: `recordSent: ${cause instanceof Error ? cause.message : 'failed'}`,
        persisted: false,
      });
    }
  }

  return result;
}
