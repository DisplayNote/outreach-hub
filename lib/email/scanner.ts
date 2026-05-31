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
  /** Defaults to the store's persisted high-water mark
   * (organizations.settings.lastInboxScanAt via lastScanHighWater()). */
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

  // Process oldest-first. The next scan resumes from the high-water mark. Drivers
  // may return newest-first (Mailpit does), so if we recorded a newer message and
  // then a fetch/record for an OLDER one threw, the high-water would jump past
  // that older message and the next scan's `since` would never re-fetch it.
  // Ascending order means any failure leaves the high-water below every
  // still-unprocessed message. Compare PARSED times, not the raw ISO strings:
  // mixed precisions sort wrong lexically (`…00.500Z` < `…00Z` as text, but is
  // later in time).
  const messages = fetched.slice().sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));

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

  // Advance the high-water to the newest message seen (by parsed time), even if
  // every one was ignored/deduped — otherwise a mailbox with no correlated
  // inbound would re-fetch the whole inbox every scan. We land EXACTLY on the
  // newest timestamp (not past it): provider timestamps aren't unique at ms
  // precision, so a late message sharing the newest ms would be skipped if we
  // moved beyond it. Keeping the cursor on the boundary means `receivedAt >=
  // since` re-fetches only that boundary on the next scan, which dedup
  // (inboundAlreadyRecorded) absorbs — bounded overlap, no skips. Only after the
  // loop completes without throwing: a mid-scan failure leaves the cursor put so
  // the next scan re-fetches and retries.
  const newestMs = messages.reduce((max, m) => {
    const t = Date.parse(m.receivedAt);
    return Number.isFinite(t) && t > max ? t : max;
  }, Number.NEGATIVE_INFINITY);
  if (Number.isFinite(newestMs)) {
    await deps.store.advanceScanCursor(new Date(newestMs).toISOString());
  }

  return result;
}
