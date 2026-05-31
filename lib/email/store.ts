/**
 * The database surface the email runner/scanner need (PHASE_5_SPEC §5–§8),
 * behind an interface so the cores are unit-testable with an in-memory fake. The
 * Supabase adapter ({@link supabaseEmailStore}) backs it in production, composing
 * the existing Phase-2 effects (status precedence, touchpoints) where relevant.
 *
 * Every method is org-scoped by the caller: the manual Server Actions pass an
 * RLS-scoped client (so `current_org_id()` filters rows); the cron route passes
 * a service-role client and the resolved `orgId`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact, OrgSettings } from '@/lib/types/domain';
import { resolveStatusEffect } from '@/lib/dialler/outcomes';
import { escapeLike } from '@/lib/supabase/like';
import { isSystemSender } from '@/lib/email/classify';
import type { SentRef, InboundMessage } from '@/lib/email/types';
import { toContact, type ContactRow } from '@/lib/supabase/queries';

/** A contact that is due to be emailed, with its sequence step resolved. */
export interface DueContact {
  contact: Contact;
  campaignId: string;
  /** The current step's day_offset (=== contact.sequenceDay). */
  sequenceDay: number;
  /** The next step's day_offset (for scheduling the follow-up), or null at the last step. */
  nextDayOffset: number | null;
  /** The template subject/body for the current step, or null when the step has none. */
  template: { subject: string | null; body: string | null } | null;
}

export interface RecordSentInput {
  orgId: string;
  contact: Contact;
  campaignId: string;
  ref: SentRef;
  subject: string;
  sequenceDay: number;
  nextSequenceDay: number | null;
  nextFollowUp: string | null;
  now: string;
}

export interface RecordInboundInput {
  orgId: string;
  contactId: string;
  campaignId: string | null;
  kind: 'reply' | 'bounce';
  message: InboundMessage;
  now: string;
}

export interface CorrelationKeys {
  inReplyTo: string | null;
  /** RFC 5322 References chain (message-ids of the thread). A reply may carry
   * References but no In-Reply-To; any one matching a prior sent message_id
   * correlates it. */
  references: string[];
  conversationId: string | null;
  /** The address to correlate on: the sender for a reply, the recovered failed
   * recipient for a bounce (the scanner resolves which — an NDR's actual sender
   * is the system mailer, never the prospect). */
  from: string;
  /** When the inbound arrived — the sender fallback only matches a `sent` event
   * that occurred no later than this (an inbound can't be a reply to a send that
   * hadn't happened yet). */
  receivedAt: string;
}

export interface EmailStore {
  /**
   * Eligible + enrolled + non-suppressed contacts due on/before `today` (§5),
   * most-overdue first. `limit` bounds the fetch (the runner passes the daily
   * cap) so a huge overdue queue isn't materialised — and the suppression lookup
   * stays small — just to send a small capped batch.
   */
  dueContacts(today: string, limit?: number): Promise<DueContact[]>;
  /** Cheap head count of due candidates (POST suppression/sequence/step filter),
   * for reporting how many remain beyond the cap without materialising them. */
  countDue(today: string): Promise<number>;
  /**
   * Atomically claim a contact for sending: set last_emailed_at = `now` only if
   * it still passes the FULL due predicate AND fewer than `dailyGoal` contacts
   * have already been claimed today, returning whether THIS call won. Two
   * overlapping runs that both fetched the same due row can't both send — the
   * loser gets false — and the in-claim cap check stops concurrent runs from
   * collectively exceeding the goal via their over-fetch buffers. On a TRANSPORT
   * failure the caller must {@link releaseClaim} to undo this marker.
   */
  claimForSend(contactId: string, today: string, now: string, dailyGoal: number): Promise<boolean>;
  /**
   * Undo a claim when the send never left (transport error): restore
   * last_emailed_at to `priorLastEmailedAt`, but only if it still equals
   * `claimedAt` (i.e. nothing else re-claimed/advanced it meanwhile). So a
   * transport failure neither blocks a same-day retry nor counts toward the cap.
   */
  releaseClaim(contactId: string, claimedAt: string, priorLastEmailedAt: string | null): Promise<void>;
  /**
   * Emails sent today for daily-cap accounting — counts CLAIMED contacts
   * (last_emailed_at >= today), NOT persisted email_events(sent). A send that
   * succeeded but whose recordSent failed keeps its claim and so still counts,
   * so a later same-day run can't see freed headroom and exceed the goal.
   */
  sentCountToday(today: string): Promise<number>;
  /** Persist a send: email_events(sent) + touchpoint + advance the contact (§4/§8). */
  recordSent(input: RecordSentInput): Promise<void>;
  /** Find the contact a reply/bounce correlates to, or null (§6). */
  findSentForCorrelation(keys: CorrelationKeys): Promise<{ contactId: string; campaignId: string | null } | null>;
  /** True if this inbound provider message was already recorded (dedup, §6/§7). */
  inboundAlreadyRecorded(provider: string, messageId: string): Promise<boolean>;
  /** Persist a reply/bounce: email_events + status + suppression + touchpoint (§8). */
  recordInbound(input: RecordInboundInput): Promise<void>;
  /**
   * The persisted inbox-scan cursor for the given mailbox (§6): the newest
   * message's ISO timestamp (`at`) plus the message-ids seen at exactly that
   * timestamp (`ids`, the boundary tie-breaker). Per-mailbox so one mailbox's
   * scan can't advance/skip another's. Null if that mailbox was never scanned.
   */
  loadScanCursor(mailbox: string): Promise<ScanCursor | null>;
  /** Persist a new per-mailbox inbox-scan cursor (newest timestamp + the ids seen at it). */
  advanceScanCursor(mailbox: string, at: string, ids: string[]): Promise<void>;
}

/** Inbox-scan high-water mark plus the boundary ids seen at `at` (see §6). */
export interface ScanCursor {
  at: string;
  ids: string[];
}

// --- Supabase adapter --------------------------------------------------------

/** A row returned by the due_email_contacts RPC (snake_case, `contact` is a row jsonb). */
interface DueContactRpcRow {
  contact: ContactRow;
  campaign_id: string;
  sequence_day: number;
  next_day_offset: number | null;
  has_template: boolean;
  template_subject: string | null;
  template_body: string | null;
}

/**
 * Build the Supabase-backed store. `provider`/`settings` are captured so the
 * adapter can stamp events and apply the org's status precedence.
 */
export function supabaseEmailStore(
  client: SupabaseClient,
  ctx: { orgId: string; provider: string; settings: OrgSettings },
): EmailStore {
  const skipWeekends = ctx.settings.seqSkipWeekends ?? true;
  void skipWeekends; // scheduling is computed by the runner; kept for parity

  return {
    async dueContacts(today, limit) {
      // Full selection happens server-side (due_email_contacts RPC): enrolment,
      // non-terminal status, has-email, not-emailed-today, campaign→sequence link,
      // a step at the contact's current sequence_day, and a suppression anti-join
      // — all filtered, ordered most-overdue, and limited in ONE query. This
      // returns only sendable rows, so a client-side limit can't starve the batch
      // with suppressed/unlinked leaders, and there's no giant suppression in(...).
      // p_limit null = all rows (the queue page); the runner passes its cap.
      const { data, error } = await client.rpc('due_email_contacts', {
        p_org_id: ctx.orgId,
        p_today: today,
        p_limit: limit ?? null,
      });
      if (error) throw new Error(`dueContacts: ${error.message}`);
      return ((data ?? []) as DueContactRpcRow[]).map((r) => ({
        contact: toContact(r.contact),
        campaignId: r.campaign_id,
        sequenceDay: r.sequence_day,
        nextDayOffset: r.next_day_offset ?? null,
        // has_template distinguishes "no template linked" (skip+surface) from a
        // template whose subject/body are themselves null (render the signature).
        template: r.has_template ? { subject: r.template_subject, body: r.template_body } : null,
      }));
    },

    async countDue(today) {
      // Same predicate as due_email_contacts (POST suppression/sequence/step
      // filtering), so runSender().remaining is the real count beyond the cap.
      const { data, error } = await client.rpc('count_due_email_contacts', {
        p_org_id: ctx.orgId,
        p_today: today,
      });
      if (error) throw new Error(`countDue: ${error.message}`);
      return (data as number | null) ?? 0;
    },

    async claimForSend(contactId, today, now, dailyGoal) {
      // Atomic claim via the claim_email_send RPC: one conditional UPDATE that
      // re-checks ALL the due stop conditions (not-sent-today, non-terminal
      // status, not suppressed, sequence-linked email step) AND the daily cap
      // under the row lock — so a late reply/bounce/manual suppression can't be
      // raced into a send, two overlapping runs can't both win, and concurrent
      // runs can't collectively exceed dailyGoal. A claim-then-send-failure leaves
      // the contact marked today (retried next day, not double-sent today).
      const { data, error } = await client.rpc('claim_email_send', {
        p_org_id: ctx.orgId,
        p_contact_id: contactId,
        p_today: today,
        p_now: now,
        p_daily_goal: dailyGoal,
      });
      if (error) throw new Error(`claimForSend: ${error.message}`);
      return data === true;
    },

    async releaseClaim(contactId, claimedAt, priorLastEmailedAt) {
      // Conditional restore: only revert if last_emailed_at is still OUR claim
      // value (nothing else re-claimed or advanced the contact since). Restores
      // the pre-claim value (null or an older send date), so the contact is due
      // again today and isn't counted toward the cap.
      const { error } = await client
        .from('contacts')
        .update({ last_emailed_at: priorLastEmailedAt })
        .eq('id', contactId)
        .eq('org_id', ctx.orgId)
        .eq('last_emailed_at', claimedAt);
      if (error) throw new Error(`releaseClaim: ${error.message}`);
    },

    async sentCountToday(today) {
      // Count CLAIMED contacts (last_emailed_at today), not persisted
      // email_events(sent): claim_email_send sets last_emailed_at before the
      // external send, so a send that succeeded but whose recordSent failed is
      // still counted — otherwise a later run the same day would see freed
      // headroom and exceed dailyGoal after a persistence failure. One email per
      // contact per day, so a contact count = emails sent today.
      const { count, error } = await client
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', ctx.orgId)
        .gte('last_emailed_at', `${today}T00:00:00.000Z`);
      if (error) throw new Error(`sentCountToday: ${error.message}`);
      return count ?? 0;
    },

    async recordSent(input) {
      // One transactional RPC: the contact advance + audit event + touchpoint
      // commit or roll back together, so a partial failure can't leave a sent
      // contact with no audit trail (or advance it without recording the send).
      // The email itself is external/non-transactional, so a rolled-back send is
      // re-attempted next run (the unavoidable at-least-once for outbound mail).
      const { error } = await client.rpc('record_email_sent', {
        p_org_id: input.orgId,
        p_contact_id: input.contact.id,
        p_campaign_id: input.campaignId,
        p_provider: ctx.provider,
        p_message_id: input.ref.messageId,
        p_subject: input.subject,
        p_sequence_day: input.sequenceDay,
        p_next_sequence_day: input.nextSequenceDay,
        p_next_follow_up: input.nextFollowUp,
        p_occurred_at: input.ref.sentAt,
        p_now: input.now,
      });
      if (error) throw new Error(`recordSent: ${error.message}`);
    },

    async findSentForCorrelation(keys) {
      // Match the inbound to a prior sent: by in_reply_to / conversation_id
      // first, else by the sender address against a contact we emailed. Use
      // parameterized .eq() per field — inbound header values are untrusted and
      // must not be interpolated into a PostgREST .or() filter string (commas /
      // filter syntax could change the query semantics).
      const byField = async (column: 'message_id' | 'conversation_id', value: string) => {
        const { data, error } = await client
          .from('email_events')
          .select('contact_id, campaign_id')
          .eq('org_id', ctx.orgId)
          .eq('type', 'sent')
          .eq(column, value)
          .limit(1)
          .maybeSingle();
        if (error) throw new Error(`findSentForCorrelation.${column}: ${error.message}`);
        return data ? { contactId: data.contact_id as string, campaignId: (data.campaign_id as string) ?? null } : null;
      };
      if (keys.inReplyTo) {
        const hit = await byField('message_id', keys.inReplyTo);
        if (hit) return hit;
      }
      // References chain: a reply may thread via References without an In-Reply-To.
      // Any reference matching a prior sent message_id correlates it.
      for (const ref of keys.references) {
        if (!ref) continue;
        const hit = await byField('message_id', ref);
        if (hit) return hit;
      }
      if (keys.conversationId) {
        const hit = await byField('conversation_id', keys.conversationId);
        if (hit) return hit;
      }
      // Fallback: the correlation address (sender for a reply, failed recipient
      // for a bounce — the scanner already resolved it) → a contact we have a
      // sent event for. Never correlate on a system-mailer address: defends
      // against a stray system sender slipping through as the correlation key.
      const fromEmail = extractEmail(keys.from);
      if (fromEmail && !isSystemSender(keys.from)) {
        const { data, error } = await client
          .from('contacts')
          .select('id, campaign_id')
          .eq('org_id', ctx.orgId)
          // ilike for case-insensitive match; wildcards escaped so the address
          // is matched literally (see escapeLike).
          .ilike('email', escapeLike(fromEmail))
          .limit(1)
          .maybeSingle();
        if (error) throw new Error(`findSentForCorrelation.contact: ${error.message}`);
        if (data) {
          // Only correlate if we actually emailed this contact AT OR BEFORE this
          // inbound arrived — otherwise an unsolicited (or pre-existing, older)
          // inbound from a known address would be treated as a reply/bounce and
          // mutate/suppress them. The occurred_at guard scopes the match to a
          // send that this inbound could plausibly be answering.
          const contactId = data.id as string;
          const { count, error: sentErr } = await client
            .from('email_events')
            .select('id', { count: 'exact', head: true })
            .eq('org_id', ctx.orgId)
            .eq('contact_id', contactId)
            .eq('type', 'sent')
            .lte('occurred_at', keys.receivedAt);
          if (sentErr) throw new Error(`findSentForCorrelation.sent: ${sentErr.message}`);
          if ((count ?? 0) > 0) return { contactId, campaignId: (data.campaign_id as string) ?? null };
        }
      }
      return null;
    },

    async inboundAlreadyRecorded(provider, messageId) {
      const { count, error } = await client
        .from('email_events')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', ctx.orgId)
        .eq('provider', provider)
        .eq('message_id', messageId)
        .in('type', ['reply', 'bounce']);
      if (error) throw new Error(`inboundAlreadyRecorded: ${error.message}`);
      return (count ?? 0) > 0;
    },

    async recordInbound(input) {
      const note =
        input.kind === 'reply' ? 'Reply received' : 'Bounced — address undeliverable';
      const reason = input.kind === 'reply' ? 'replied' : 'bounced';
      const nextStatus = input.kind === 'reply' ? 'green' : 'bounced';

      // Apply the idempotent effects FIRST (status, suppression, touchpoint) and
      // insert the email_events dedup marker LAST. The scanner skips a message
      // once that marker exists, so writing it last means a partial failure
      // leaves the marker absent and the next scan re-applies the (idempotent)
      // effects — the stop-sequence effect can't be lost.

      // Read the contact's status AND email together (for the status effect and
      // the reply suppression address).
      const { data: cur, error: curErr } = await client
        .from('contacts')
        .select('status, email')
        .eq('id', input.contactId)
        .eq('org_id', input.orgId)
        .maybeSingle();
      if (curErr) throw new Error(`recordInbound.read: ${curErr.message}`);
      const contactEmail = (cur?.email as string | null)?.trim().toLowerCase() ?? null;
      const failedRecipient = input.message.failedRecipient?.trim().toLowerCase() ?? null;
      // A BOUNCE only marks the CONTACT terminal (`bounced`) when the address that
      // bounced is still the contact's current email. If the email was corrected
      // between send and bounce-scan, the OLD address bounced — suppress that old
      // address (below), but DON'T strand the contact on their new (presumably
      // good) address with a terminal status. A reply always applies its effect.
      const applyStatus = input.kind === 'reply' || (failedRecipient !== null && failedRecipient === contactEmail);
      if (cur && applyStatus) {
        const next = resolveStatusEffect((cur.status as Contact['status']) ?? 'none', nextStatus);
        if (next !== null) {
          const { error: sErr } = await client
            .from('contacts')
            .update({ status: next })
            .eq('id', input.contactId)
            .eq('org_id', input.orgId);
          if (sErr) throw new Error(`recordInbound.status: ${sErr.message}`);
        }
      }

      // Address to suppress (deduped via the unique (org_id, email) index):
      //   • BOUNCE → the address that actually bounced (the NDR's failed
      //     recipient), NOT the contact's CURRENT email. If the email was
      //     corrected between send and bounce-scan, suppressing the current
      //     address would block a good address and leave the bad one unsuppressed.
      //     (failedRecipient is the prospect recovered from the NDR — never the
      //     postmaster/mailer-daemon sender.)
      //   • REPLY → the contact's email (the address we send to), to stop the
      //     sequence to that prospect.
      const suppressEmail = input.kind === 'bounce' ? (failedRecipient ?? contactEmail) : contactEmail;
      if (suppressEmail) {
        const { error: supErr } = await client.from('suppressions').upsert(
          {
            org_id: input.orgId,
            email: suppressEmail,
            reason,
            contact_id: input.contactId,
          },
          { onConflict: 'org_id,email', ignoreDuplicates: true },
        );
        if (supErr) throw new Error(`recordInbound.suppression: ${supErr.message}`);
      }

      // Touchpoint (deduped by the provider message id).
      const { error: tpErr } = await client.from('touchpoints').upsert(
        {
          org_id: input.orgId,
          contact_id: input.contactId,
          channel: 'email',
          note,
          occurred_at: input.message.receivedAt,
          legacy_id: `email-${input.kind}-${ctx.provider}-${input.message.messageId}`,
        },
        { onConflict: 'org_id,legacy_id', ignoreDuplicates: true },
      );
      if (tpErr) throw new Error(`recordInbound.touchpoint: ${tpErr.message}`);

      // Dedup marker LAST — only now is the message considered processed.
      const { error: evErr } = await client.from('email_events').upsert(
        {
          org_id: input.orgId,
          contact_id: input.contactId,
          campaign_id: input.campaignId,
          type: input.kind,
          provider: ctx.provider,
          message_id: input.message.messageId,
          conversation_id: input.message.conversationId ?? null,
          in_reply_to: input.message.inReplyTo ?? null,
          subject: input.message.subject,
          occurred_at: input.message.receivedAt,
        },
        { onConflict: 'org_id,provider,message_id', ignoreDuplicates: true },
      );
      if (evErr) throw new Error(`recordInbound.event: ${evErr.message}`);
    },

    async loadScanCursor(mailbox) {
      // Per-mailbox cursor (organizations.settings.inboxScanCursors[mailbox]),
      // captured fresh per invocation via getOrgSettings. Keyed by mailbox so a
      // different mailbox's scan can't advance/skip this one. Deriving it from
      // recorded reply/bounce events instead would never advance for a mailbox
      // with no correlated inbound, re-fetching the whole inbox every tick.
      const map = ctx.settings.inboxScanCursors;
      const entry = map && typeof map === 'object' ? map[mailbox] : undefined;
      if (!entry || typeof entry.at !== 'string') return null;
      const raw = (entry as { ids?: unknown }).ids;
      const ids = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
      return { at: entry.at, ids };
    },

    async advanceScanCursor(mailbox, at, ids) {
      // Atomic per-mailbox jsonb_set merge (advance_inbox_scan_cursor RPC): only
      // settings.inboxScanCursors[mailbox] changes, so a concurrent settings save
      // and other mailboxes' cursors are never clobbered. Scoped to ctx.orgId; RLS
      // limits org UPDATE to the settings column (Phase 2), cron uses service role.
      const { error } = await client.rpc('advance_inbox_scan_cursor', {
        p_org_id: ctx.orgId,
        p_mailbox: mailbox,
        p_at: at,
        p_ids: ids,
      });
      if (error) throw new Error(`advanceScanCursor: ${error.message}`);
    },
  };
}

/** Extract a bare email from a possibly display-name-wrapped `From` value. */
export function extractEmail(from: string): string | null {
  const angle = /<([^>]+)>/.exec(from);
  const candidate = (angle?.[1] ?? from).trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+$/.test(candidate) ? candidate : null;
}
