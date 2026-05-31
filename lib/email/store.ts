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
   * it's still un-sent today, returning whether THIS call won the claim. Two
   * overlapping runs that both fetched the same due row can't both send — the
   * loser gets false. (The provider message id is per-send, so the email_events
   * unique index can't dedupe a concurrent double-send; this is the guard.)
   */
  claimForSend(contactId: string, today: string, now: string): Promise<boolean>;
  /** Count of `sent` events on/after `today` (daily-cap accounting). */
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
   * The persisted inbox-scan cursor (§6): the newest message's ISO timestamp
   * (`at`) plus the message-ids seen at exactly that timestamp (`ids`, the
   * boundary tie-breaker). Null if never scanned.
   */
  loadScanCursor(): Promise<ScanCursor | null>;
  /** Persist a new inbox-scan cursor (newest timestamp + the ids seen at it). */
  advanceScanCursor(at: string, ids: string[]): Promise<void>;
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

    async claimForSend(contactId, today, now) {
      // Conditional UPDATE = atomic claim: the row lock serialises concurrent
      // runs, and the `last_emailed_at` predicate is re-checked after the lock,
      // so only the first run matches a row. A claim-then-send-failure leaves the
      // contact marked today (retried next day, not double-sent today) — the safe
      // trade for preventing duplicate outbound mail.
      const { data, error } = await client
        .from('contacts')
        .update({ last_emailed_at: now })
        .eq('id', contactId)
        .eq('org_id', ctx.orgId)
        .or(`last_emailed_at.is.null,last_emailed_at.lt.${today}T00:00:00.000Z`)
        .select('id');
      if (error) throw new Error(`claimForSend: ${error.message}`);
      return (data?.length ?? 0) > 0;
    },

    async sentCountToday(today) {
      const { count, error } = await client
        .from('email_events')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', ctx.orgId)
        .eq('type', 'sent')
        .gte('occurred_at', `${today}T00:00:00.000Z`);
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

      // Read the contact's status AND email together: the suppression must use
      // the contact's own address, NOT the inbound sender (a real NDR is from
      // postmaster@…, not the failed prospect).
      const { data: cur, error: curErr } = await client
        .from('contacts')
        .select('status, email')
        .eq('id', input.contactId)
        .eq('org_id', input.orgId)
        .maybeSingle();
      if (curErr) throw new Error(`recordInbound.read: ${curErr.message}`);
      if (cur) {
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

      // Address-level suppression on the CONTACT's email (deduped via the unique
      // (org_id, email) index). Skip if the contact somehow has no address.
      const contactEmail = (cur?.email as string | null)?.trim().toLowerCase() ?? null;
      if (contactEmail) {
        const { error: supErr } = await client.from('suppressions').upsert(
          {
            org_id: input.orgId,
            email: contactEmail,
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

    async loadScanCursor() {
      // The persisted cursor (organizations.settings.lastInboxScan{At,Ids}),
      // captured fresh per invocation via getOrgSettings. Deriving it from
      // recorded reply/bounce events instead would never advance for a mailbox
      // with no correlated inbound, re-fetching the whole inbox every cron tick.
      const at = ctx.settings.lastInboxScanAt;
      if (typeof at !== 'string') return null;
      const raw = ctx.settings.lastInboxScanIds;
      const ids = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
      return { at, ids };
    },

    async advanceScanCursor(at, ids) {
      // Atomic single-statement jsonb merge (advance_inbox_scan_cursor RPC): only
      // the lastInboxScan{At,Ids} keys change, so a concurrent settings save can't
      // be clobbered by a stale read-merge-write. Scoped to ctx.orgId; RLS limits
      // org UPDATE to the settings column (Phase 2), cron uses the service role.
      const { error } = await client.rpc('advance_inbox_scan_cursor', {
        p_org_id: ctx.orgId,
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
