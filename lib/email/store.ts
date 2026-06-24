/**
 * The database surface the email runner/scanner need (PHASE_5_SPEC §5–§8),
 * behind an interface so the cores are unit-testable with an in-memory fake. The
 * Drizzle adapter ({@link drizzleEmailStore}) backs it in production, composing
 * the existing Phase-2 effects (status precedence, touchpoints) where relevant.
 *
 * Every method is org-scoped by the caller's RLS session: the manual Server
 * Actions pass a runner that wraps {@link withRls} (so `current_org_id()` filters
 * rows under the acting user); the cron route passes a runner that wraps
 * {@link withServiceRls} with the resolved `orgId` (org-scoped, no acting user).
 * RLS stays the multi-tenant boundary — there are no app-layer org filters here;
 * the explicit `org_id` predicates only target a specific row / satisfy the
 * WITH CHECK on insert.
 */
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { Contact, OrgSettings } from '@/lib/types/domain';
import type { DrizzleTx } from '@/lib/db/rls';
import { resolveStatusEffect } from '@/lib/dialler/outcomes';
import { escapeLike } from '@/lib/supabase/like';
import { isSystemSender } from '@/lib/email/classify';
import type { SentRef, InboundMessage } from '@/lib/email/types';
import { toContact, type ContactRow } from '@/lib/db/contact-row';
import { contacts, emailEvents, suppressions, touchpoints } from '@/lib/db/schema';

/**
 * Runs `fn` inside an RLS-scoped transaction. The caller supplies the binding:
 * `(fn) => withRls(rlsCtxFromSession(session), fn)` on the user path, or
 * `(fn) => withServiceRls(orgId, fn)` on the cron path. Each store method runs
 * in its own short transaction so the SET LOCAL GUCs never leak between calls.
 */
export type TxRunner = <T>(fn: (tx: DrizzleTx) => Promise<T>) => Promise<T>;

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
  /** The address actually emailed (the claimed live address), recorded as the
   * sent event's recipient for bounce-by-recipient correlation. */
  recipient: string;
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
   * have already been claimed today. Returns the contact's CURRENT email when
   * THIS call won the claim (so the caller sends to the live address it just
   * claimed, not a possibly-stale pre-claim snapshot), or null when lost. Two
   * overlapping runs can't both win, and the in-claim cap check stops concurrent
   * runs from collectively exceeding the goal via their over-fetch buffers. On a
   * TRANSPORT failure the caller must {@link releaseClaim} to undo this marker.
   */
  claimForSend(contactId: string, today: string, now: string, dailyGoal: number): Promise<string | null>;
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

// --- Drizzle adapter ---------------------------------------------------------

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
 * Build the Drizzle-backed store. `runTx` binds the RLS session (withRls for the
 * user path, withServiceRls for cron); `provider`/`settings` are captured so the
 * adapter can stamp events and apply the org's status precedence.
 */
export function drizzleEmailStore(
  runTx: TxRunner,
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
      const rows = await runTx(async (tx) => {
        const result = await tx.execute(
          sql`select contact, campaign_id, sequence_day, next_day_offset, has_template, template_subject, template_body
              from public.due_email_contacts(${ctx.orgId}, ${today}, ${limit ?? null})`,
        );
        return result.rows as unknown as DueContactRpcRow[];
      });
      return rows.map((r) => ({
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
      return runTx(async (tx) => {
        const result = await tx.execute(
          sql`select public.count_due_email_contacts(${ctx.orgId}, ${today}) as count`,
        );
        const row = result.rows[0] as { count: number | string | null } | undefined;
        return Number(row?.count ?? 0);
      });
    },

    async claimForSend(contactId, today, now, dailyGoal) {
      // Atomic claim via the claim_email_send RPC: one conditional UPDATE that
      // re-checks ALL the due stop conditions (not-sent-today, non-terminal
      // status, not suppressed, sequence-linked email step) AND the daily cap
      // under the row lock — so a late reply/bounce/manual suppression can't be
      // raced into a send, two overlapping runs can't both win, and concurrent
      // runs can't collectively exceed dailyGoal. A claim-then-send-failure leaves
      // the contact marked today (retried next day, not double-sent today).
      return runTx(async (tx) => {
        const result = await tx.execute(
          sql`select public.claim_email_send(${ctx.orgId}, ${contactId}, ${today}, ${now}, ${dailyGoal}) as email`,
        );
        // RPC returns the claimed CURRENT email (won) or null (lost). Send to this,
        // not the pre-claim snapshot, so an email edited since selection is honoured.
        const row = result.rows[0] as { email: string | null } | undefined;
        return row?.email ?? null;
      });
    },

    async releaseClaim(contactId, claimedAt, priorLastEmailedAt) {
      // Conditional restore: only revert if last_emailed_at is still OUR claim
      // value (nothing else re-claimed or advanced the contact since). Restores
      // the pre-claim value (null or an older send date), so the contact is due
      // again today and isn't counted toward the cap.
      await runTx(async (tx) => {
        await tx
          .update(contacts)
          .set({ lastEmailedAt: priorLastEmailedAt })
          .where(
            and(
              eq(contacts.id, contactId),
              eq(contacts.orgId, ctx.orgId),
              eq(contacts.lastEmailedAt, claimedAt),
            ),
          );
      });
    },

    async sentCountToday(today) {
      // Count CLAIMED contacts (last_emailed_at today), not persisted
      // email_events(sent): claim_email_send sets last_emailed_at before the
      // external send, so a send that succeeded but whose recordSent failed is
      // still counted — otherwise a later run the same day would see freed
      // headroom and exceed dailyGoal after a persistence failure. One email per
      // contact per day, so a contact count = emails sent today.
      return runTx(async (tx) => {
        const result = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(contacts)
          .where(
            and(
              eq(contacts.orgId, ctx.orgId),
              gte(contacts.lastEmailedAt, `${today}T00:00:00.000Z`),
            ),
          );
        return result[0]?.count ?? 0;
      });
    },

    async recordSent(input) {
      // One transactional RPC: the contact advance + audit event + touchpoint
      // commit or roll back together, so a partial failure can't leave a sent
      // contact with no audit trail (or advance it without recording the send).
      // The email itself is external/non-transactional, so a rolled-back send is
      // re-attempted next run (the unavoidable at-least-once for outbound mail).
      await runTx(async (tx) => {
        await tx.execute(
          sql`select public.record_email_sent(
            ${input.orgId},
            ${input.contact.id},
            ${input.campaignId},
            ${ctx.provider},
            ${input.ref.messageId},
            ${input.recipient.trim().toLowerCase()},
            ${input.subject},
            ${input.sequenceDay},
            ${input.nextSequenceDay},
            ${input.nextFollowUp},
            ${input.ref.sentAt},
            ${input.now}
          )`,
        );
      });
    },

    async findSentForCorrelation(keys) {
      // Match the inbound to a prior sent: by in_reply_to / conversation_id
      // first, else by the sender address against a contact we emailed. Use
      // parameterized equality per field — inbound header values are untrusted and
      // bound as query parameters, never interpolated into SQL text.
      return runTx(async (tx) => {
        const byField = async (column: 'messageId' | 'conversationId', value: string) => {
          const [row] = await tx
            .select({ contactId: emailEvents.contactId, campaignId: emailEvents.campaignId })
            .from(emailEvents)
            .where(
              and(
                eq(emailEvents.orgId, ctx.orgId),
                eq(emailEvents.type, 'sent'),
                eq(emailEvents[column], value),
              ),
            )
            .limit(1);
          return row ? { contactId: row.contactId, campaignId: row.campaignId ?? null } : null;
        };
        if (keys.inReplyTo) {
          const hit = await byField('messageId', keys.inReplyTo);
          if (hit) return hit;
        }
        // References chain: a reply may thread via References without an In-Reply-To.
        // Any reference matching a prior sent message_id correlates it.
        for (const ref of keys.references) {
          if (!ref) continue;
          const hit = await byField('messageId', ref);
          if (hit) return hit;
        }
        if (keys.conversationId) {
          const hit = await byField('conversationId', keys.conversationId);
          if (hit) return hit;
        }
        // Fallback: the correlation address (sender for a reply, failed recipient
        // for a bounce — the scanner already resolved it) → a contact we have a
        // sent event for. Never correlate on a system-mailer address: defends
        // against a stray system sender slipping through as the correlation key.
        const fromEmail = extractEmail(keys.from);
        if (fromEmail && !isSystemSender(keys.from)) {
          const [contactHit] = await tx
            .select({ id: contacts.id, campaignId: contacts.campaignId })
            .from(contacts)
            .where(
              and(
                eq(contacts.orgId, ctx.orgId),
                // ilike for case-insensitive match; wildcards escaped so the address
                // is matched literally (see escapeLike).
                sql`${contacts.email} ilike ${escapeLike(fromEmail)}`,
              ),
            )
            .limit(1);
          if (contactHit) {
            // Only correlate if we actually emailed this contact AT OR BEFORE this
            // inbound arrived — otherwise an unsolicited (or pre-existing, older)
            // inbound from a known address would be treated as a reply/bounce and
            // mutate/suppress them. The occurred_at guard scopes the match to a
            // send that this inbound could plausibly be answering.
            const contactId = contactHit.id;
            const [{ count } = { count: 0 }] = await tx
              .select({ count: sql<number>`count(*)::int` })
              .from(emailEvents)
              .where(
                and(
                  eq(emailEvents.orgId, ctx.orgId),
                  eq(emailEvents.contactId, contactId),
                  eq(emailEvents.type, 'sent'),
                  lte(emailEvents.occurredAt, keys.receivedAt),
                ),
              );
            if ((count ?? 0) > 0) return { contactId, campaignId: contactHit.campaignId ?? null };
          }

          // Recipient-history fallback: match the address against what we ACTUALLY
          // emailed (email_events.recipient on a 'sent' row), not just the contact's
          // CURRENT email. A bounce for an address that was corrected on the contact
          // after the send won't match contacts.email above, so without this the bad
          // address would never be suppressed. The occurred_at guard keeps it to a
          // send this inbound could be answering.
          const [sentRow] = await tx
            .select({ contactId: emailEvents.contactId, campaignId: emailEvents.campaignId })
            .from(emailEvents)
            .where(
              and(
                eq(emailEvents.orgId, ctx.orgId),
                eq(emailEvents.type, 'sent'),
                eq(emailEvents.recipient, fromEmail),
                lte(emailEvents.occurredAt, keys.receivedAt),
              ),
            )
            .orderBy(sql`${emailEvents.occurredAt} desc`)
            .limit(1);
          if (sentRow) {
            return {
              contactId: sentRow.contactId,
              campaignId: sentRow.campaignId ?? null,
            };
          }
        }
        return null;
      });
    },

    async inboundAlreadyRecorded(provider, messageId) {
      return runTx(async (tx) => {
        const [{ count } = { count: 0 }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(emailEvents)
          .where(
            and(
              eq(emailEvents.orgId, ctx.orgId),
              eq(emailEvents.provider, provider),
              eq(emailEvents.messageId, messageId),
              sql`${emailEvents.type} in ('reply', 'bounce')`,
            ),
          );
        return (count ?? 0) > 0;
      });
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
      await runTx(async (tx) => {
        // Read the contact's status AND email together (for the status effect and
        // the reply suppression address).
        const [cur] = await tx
          .select({ status: contacts.status, email: contacts.email })
          .from(contacts)
          .where(and(eq(contacts.id, input.contactId), eq(contacts.orgId, input.orgId)))
          .limit(1);
        // If the contact was deleted between correlation and now, there is nothing
        // to attach the effects to — the suppression/touchpoint/email_events FKs to
        // contacts would all fail, and (since we never write the dedup marker) the
        // scan would fail and re-fail on this same message forever (a poison
        // message). Skip it instead: the contact's sent events cascade-deleted with
        // it, so subsequent scans simply won't correlate this inbound (it's ignored).
        if (!cur) return;
        const contactEmail = cur.email?.trim().toLowerCase() ?? null;
        const failedRecipient = input.message.failedRecipient?.trim().toLowerCase() ?? null;
        // A BOUNCE only marks the CONTACT terminal (`bounced`) when the address that
        // bounced is still the contact's current email. If the email was corrected
        // between send and bounce-scan, the OLD address bounced — suppress that old
        // address (below), but DON'T strand the contact on their new (presumably
        // good) address with a terminal status. A reply always applies its effect.
        const applyStatus = input.kind === 'reply' || (failedRecipient !== null && failedRecipient === contactEmail);
        if (applyStatus) {
          // Compare-and-set with retry: resolveStatusEffect encodes the precedence
          // (e.g. reply→green must NOT downgrade a `meeting`) in app code, so a plain
          // read-then-write could clobber a concurrent manual status change made
          // between our read and write. Re-evaluate precedence against the LIVE
          // status and only write when it's unchanged since we read it; on a
          // concurrent change, re-read and recompute (bounded retries).
          let observed = (cur.status as Contact['status']) ?? 'none';
          let settled = false;
          for (let attempt = 0; attempt < 5; attempt += 1) {
            const next = resolveStatusEffect(observed, nextStatus);
            if (next === null || next === observed) {
              settled = true; // precedence says no change needed — done
              break;
            }
            const changed = await tx
              .update(contacts)
              .set({ status: next })
              .where(
                and(
                  eq(contacts.id, input.contactId),
                  eq(contacts.orgId, input.orgId),
                  eq(contacts.status, observed), // CAS guard: only if status hasn't moved
                ),
              )
              .returning({ id: contacts.id });
            if (changed.length > 0) {
              settled = true; // won the CAS
              break;
            }
            const [reread] = await tx
              .select({ status: contacts.status })
              .from(contacts)
              .where(and(eq(contacts.id, input.contactId), eq(contacts.orgId, input.orgId)))
              .limit(1);
            if (!reread) {
              settled = true; // contact gone — nothing to apply
              break;
            }
            observed = (reread.status as Contact['status']) ?? 'none';
          }
          // If we never settled (lost the CAS every attempt under heavy contention),
          // THROW before the email_events dedup marker is written below — so the
          // next scan re-processes this inbound and re-applies the status, rather
          // than the marker suppressing it and the effect being lost permanently.
          if (!settled) {
            throw new Error('recordInbound.status: lost compare-and-set after retries; will retry next scan');
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
          await tx
            .insert(suppressions)
            .values({
              orgId: input.orgId,
              email: suppressEmail,
              reason,
              contactId: input.contactId,
              // created_at carries a DB-side `default now()`; the schema def doesn't
              // declare it, so set it via now() to match the prior DB-default insert.
              createdAt: sql`now()`,
            })
            .onConflictDoNothing({ target: [suppressions.orgId, suppressions.email] });
        }

        // Touchpoint (deduped by the provider message id).
        await tx
          .insert(touchpoints)
          .values({
            orgId: input.orgId,
            contactId: input.contactId,
            channel: 'email',
            note,
            occurredAt: input.message.receivedAt,
            legacyId: `email-${input.kind}-${ctx.provider}-${input.message.messageId}`,
          })
          .onConflictDoNothing({ target: [touchpoints.orgId, touchpoints.legacyId] });

        // Dedup marker LAST — only now is the message considered processed.
        await tx
          .insert(emailEvents)
          .values({
            orgId: input.orgId,
            contactId: input.contactId,
            campaignId: input.campaignId,
            type: input.kind,
            provider: ctx.provider,
            messageId: input.message.messageId,
            conversationId: input.message.conversationId ?? null,
            inReplyTo: input.message.inReplyTo ?? null,
            subject: input.message.subject,
            occurredAt: input.message.receivedAt,
            payload: {},
            // created_at carries a DB-side `default now()`; the schema def doesn't
            // declare it, so set it via now() to match the prior DB-default insert.
            createdAt: sql`now()`,
          })
          .onConflictDoNothing({
            target: [emailEvents.orgId, emailEvents.provider, emailEvents.messageId],
          });
      });
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
      // p_ids is jsonb — pass a JSON string the function casts (::jsonb) so the
      // text[]→jsonb shape matches the original PostgREST array argument.
      await runTx(async (tx) => {
        await tx.execute(
          sql`select public.advance_inbox_scan_cursor(${ctx.orgId}, ${mailbox}, ${at}, ${JSON.stringify(ids)}::jsonb)`,
        );
      });
    },
  };
}

/** Extract a bare email from a possibly display-name-wrapped `From` value. */
export function extractEmail(from: string): string | null {
  const angle = /<([^>]+)>/.exec(from);
  const candidate = (angle?.[1] ?? from).trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+$/.test(candidate) ? candidate : null;
}
