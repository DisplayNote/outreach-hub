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
import type { Contact, OrgSettings, SequenceStep } from '@/lib/types/domain';
import { resolveStatusEffect } from '@/lib/dialler/outcomes';
import type { SentRef, InboundMessage } from '@/lib/email/types';
import {
  CONTACT_SELECT,
  SEQUENCE_STEP_SELECT,
  toContact,
  toSequenceStep,
  type ContactRow,
  type SequenceStepRow,
} from '@/lib/supabase/queries';

/** A contact that is due to be emailed, with its sequence resolved. */
export interface DueContact {
  contact: Contact;
  campaignId: string;
  /** The step the contact is currently on (day_offset === contact.sequenceDay). */
  step: SequenceStep;
  /** All steps of the campaign's sequence, ascending — for next-step resolution. */
  steps: SequenceStep[];
  /** The template body/subject for `step`, or null when the step has none. */
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
  from: string;
}

export interface EmailStore {
  /** Eligible + enrolled + non-suppressed contacts due on/before `today` (§5). */
  dueContacts(today: string): Promise<DueContact[]>;
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
  /** Max occurred_at across email_events, as the scan high-water mark (§6), or null. */
  lastScanHighWater(): Promise<string | null>;
}

// --- Supabase adapter --------------------------------------------------------

interface DueContactRow {
  contact: Contact;
  campaign_id: string;
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
    async dueContacts(today) {
      // Candidate contacts: enrolled (follow_up set & due), non-terminal status,
      // has an email, and not already sent today. RLS scopes to the org.
      // org_id filtered EXPLICITLY — the cron path uses the service role
      // (bypasses RLS), so without this one org's run would process every org's
      // contacts.
      const { data: rows, error } = await client
        .from('contacts')
        .select(CONTACT_SELECT)
        .eq('org_id', ctx.orgId)
        .lte('follow_up', today)
        .not('follow_up', 'is', null)
        .not('email', 'is', null)
        .not('status', 'in', '(notinterested,bounced)')
        .or(`last_emailed_at.is.null,last_emailed_at.lt.${today}T00:00:00.000Z`);
      if (error) throw new Error(`dueContacts: ${error.message}`);
      const candidates = (rows ?? []).map((r) => toContact(r as ContactRow));
      if (candidates.length === 0) return [];

      // Which of THESE candidates are suppressed — query only the candidate
      // addresses, not the whole org's suppression list (which can grow large).
      const candidateEmails = [
        ...new Set(candidates.map((c) => c.email?.trim().toLowerCase()).filter((e): e is string => !!e)),
      ];
      const { data: supRows, error: supErr } = await client
        .from('suppressions')
        .select('email')
        .eq('org_id', ctx.orgId)
        .in('email', candidateEmails);
      if (supErr) throw new Error(`dueContacts.suppressions: ${supErr.message}`);
      const suppressed = new Set((supRows ?? []).map((s) => (s.email as string).trim().toLowerCase()));

      // Campaigns that link to a sequence, and that sequence's ordered steps.
      const campaignIds = [...new Set(candidates.map((c) => c.campaignId))];
      const { data: campRows, error: campErr } = await client
        .from('campaigns')
        .select('id, sequence_id')
        .eq('org_id', ctx.orgId) // service role bypasses RLS — scope explicitly
        .in('id', campaignIds)
        .not('sequence_id', 'is', null);
      if (campErr) throw new Error(`dueContacts.campaigns: ${campErr.message}`);
      const campaignSequence = new Map<string, string>();
      for (const c of campRows ?? []) campaignSequence.set(c.id as string, c.sequence_id as string);
      if (campaignSequence.size === 0) return [];

      const sequenceIds = [...new Set(campaignSequence.values())];
      const { data: stepRows, error: stepErr } = await client
        .from('sequence_steps')
        .select(SEQUENCE_STEP_SELECT)
        .in('sequence_id', sequenceIds)
        .order('day_offset', { ascending: true });
      if (stepErr) throw new Error(`dueContacts.steps: ${stepErr.message}`);
      const stepsBySequence = new Map<string, SequenceStep[]>();
      for (const s of stepRows ?? []) {
        const step = toSequenceStep(s as SequenceStepRow);
        const list = stepsBySequence.get(step.sequenceId) ?? [];
        list.push(step);
        stepsBySequence.set(step.sequenceId, list);
      }

      // Templates referenced by those steps.
      const templateIds = [...new Set((stepRows ?? []).map((s) => s.template_id).filter(Boolean) as string[])];
      const templateById = new Map<string, { subject: string | null; body: string | null }>();
      if (templateIds.length > 0) {
        const { data: tplRows, error: tplErr } = await client
          .from('templates')
          .select('id, subject, body')
          .in('id', templateIds);
        if (tplErr) throw new Error(`dueContacts.templates: ${tplErr.message}`);
        for (const t of tplRows ?? [])
          templateById.set(t.id as string, { subject: (t.subject as string) ?? null, body: (t.body as string) ?? null });
      }

      // Assemble: keep contacts whose campaign has a sequence, whose current
      // step (day_offset === sequence_day) exists, and that aren't suppressed.
      const due: DueContact[] = [];
      for (const contact of candidates) {
        if (contact.email && suppressed.has(contact.email.trim().toLowerCase())) continue;
        const sequenceId = campaignSequence.get(contact.campaignId);
        if (!sequenceId) continue;
        const steps = stepsBySequence.get(sequenceId) ?? [];
        const step = steps.find((s) => s.dayOffset === contact.sequenceDay);
        if (!step) continue;
        due.push({
          contact,
          campaignId: contact.campaignId,
          step,
          steps,
          template: step.templateId ? (templateById.get(step.templateId) ?? null) : null,
        });
      }
      return due;
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
      // Fallback: sender address → a contact we have a sent event for.
      const fromEmail = extractEmail(keys.from);
      if (fromEmail) {
        const { data, error } = await client
          .from('contacts')
          .select('id, campaign_id')
          .eq('org_id', ctx.orgId)
          .ilike('email', fromEmail)
          .limit(1)
          .maybeSingle();
        if (error) throw new Error(`findSentForCorrelation.contact: ${error.message}`);
        if (data) {
          // Only correlate if we actually emailed this contact — otherwise an
          // unsolicited inbound from an existing contact would be treated as a
          // reply/bounce and mutate/suppress them.
          const contactId = data.id as string;
          const { count, error: sentErr } = await client
            .from('email_events')
            .select('id', { count: 'exact', head: true })
            .eq('org_id', ctx.orgId)
            .eq('contact_id', contactId)
            .eq('type', 'sent');
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

    async lastScanHighWater() {
      // Track the last INBOUND processed (reply/bounce) — not sends — so the
      // scan window covers replies that arrived around send time.
      const { data, error } = await client
        .from('email_events')
        .select('occurred_at')
        .eq('org_id', ctx.orgId)
        .in('type', ['reply', 'bounce'])
        .order('occurred_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`lastScanHighWater: ${error.message}`);
      return (data?.occurred_at as string) ?? null;
    },
  };
}

/** Extract a bare email from a possibly display-name-wrapped `From` value. */
export function extractEmail(from: string): string | null {
  const angle = /<([^>]+)>/.exec(from);
  const candidate = (angle?.[1] ?? from).trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+$/.test(candidate) ? candidate : null;
}

// `DueContactRow` reserved for a future non-RPC selection path.
export type { DueContactRow };
