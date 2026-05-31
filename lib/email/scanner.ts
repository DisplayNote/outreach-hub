/**
 * Inbox scanner (PHASE_5_SPEC §6/§7). Polls the driver for inbound mail, then
 * per message: correlate to a contact we emailed, classify reply-vs-bounce, and
 * record the effect (status + suppression + touchpoint via the store). Dedup is
 * keyed on the provider message id so re-scans are idempotent.
 *
 * Orchestrates over an injected {@link EmailStore} + {@link EmailDriver} so it's
 * unit-testable with fakes.
 */
import type { EmailDriver } from '@/lib/email/driver';
import type { EmailStore } from '@/lib/email/store';
import { classifyInbound } from '@/lib/email/classify';

export interface ScanInboxDeps {
  store: EmailStore;
  driver: EmailDriver;
  orgId: string;
}

export interface ScanInboxOptions {
  /** Defaults to the store's high-water mark (max email_events.occurred_at). */
  since?: string;
}

export interface ScanInboxResult {
  replies: number;
  bounces: number;
  ignored: number;
  deduped: number;
}

export async function scanInbox(deps: ScanInboxDeps, opts: ScanInboxOptions): Promise<ScanInboxResult> {
  const since = opts.since ?? (await deps.store.lastScanHighWater()) ?? '1970-01-01T00:00:00.000Z';
  const fetched = await deps.driver.fetchReplies({ since });

  // Process oldest-first. The next scan resumes from the high-water mark (max
  // recorded occurred_at). Drivers may return newest-first (Mailpit does), so if
  // we recorded a newer message and then a fetch/record for an OLDER one threw,
  // the high-water would jump past that older message and the next scan's
  // `since` would never re-fetch it. Ascending order means any failure leaves
  // the high-water below every still-unprocessed message.
  const messages = fetched
    .slice()
    .sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : a.receivedAt > b.receivedAt ? 1 : 0));

  const result: ScanInboxResult = { replies: 0, bounces: 0, ignored: 0, deduped: 0 };

  for (const message of messages) {
    const match = await deps.store.findSentForCorrelation({
      inReplyTo: message.inReplyTo ?? null,
      conversationId: message.conversationId ?? null,
      from: message.from,
      receivedAt: message.receivedAt,
      failedRecipient: message.failedRecipient ?? null,
    });
    if (!match) {
      result.ignored += 1;
      continue;
    }
    if (await deps.store.inboundAlreadyRecorded(deps.driver.name, message.messageId)) {
      result.deduped += 1;
      continue;
    }

    const kind = classifyInbound(message);
    await deps.store.recordInbound({
      orgId: deps.orgId,
      contactId: match.contactId,
      campaignId: match.campaignId,
      kind,
      message,
      now: message.receivedAt,
    });
    if (kind === 'reply') result.replies += 1;
    else result.bounces += 1;
  }

  // Advance the high-water to the newest message seen (messages are ascending),
  // even if every one was ignored/deduped — otherwise a mailbox with no
  // correlated inbound would re-fetch the whole inbox every scan. Only after the
  // loop completes without throwing: a mid-scan failure leaves the cursor put so
  // the next scan re-fetches and retries (dedup skips what was already recorded).
  const newest = messages[messages.length - 1]?.receivedAt;
  if (newest !== undefined && newest > since) {
    await deps.store.advanceScanCursor(newest);
  }

  return result;
}
