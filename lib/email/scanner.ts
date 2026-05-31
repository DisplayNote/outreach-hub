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

const EPOCH = '1970-01-01T00:00:00.000Z';

export async function scanInbox(deps: ScanInboxDeps, opts: ScanInboxOptions): Promise<ScanInboxResult> {
  // The persisted cursor: a timestamp + the ids seen AT that exact timestamp.
  // (An explicit opts.since override is a one-off, so it carries no boundary set.)
  const cursor = opts.since ? null : await deps.store.loadScanCursor();
  const since = opts.since ?? cursor?.at ?? EPOCH;
  const sinceMs = Date.parse(since);
  const boundarySeen = new Set(cursor?.ids ?? []);

  const fetched = await deps.driver.fetchReplies({ since });

  // Drop boundary messages already processed by a previous scan: drivers fetch
  // `receivedAt >= since`, so a message AT the cursor timestamp is re-fetched
  // every run. We skip it iff its id is in the cursor's boundary set — a NEW
  // message sharing that exact millisecond (a different id) is NOT in the set, so
  // it's still processed. This is what makes "land exactly on the newest
  // timestamp" safe: no re-processing the boundary, no skipping a same-ms arrival.
  // Process oldest-first (by PARSED time — mixed ISO precisions sort wrong
  // lexically, `…00.500Z` < `…00Z` as text but is later) so a mid-scan failure
  // leaves the high-water below every still-unprocessed message.
  const messages = fetched
    .filter((m) => !(boundarySeen.has(m.messageId) && Date.parse(m.receivedAt) === sinceMs))
    .sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));

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

  // Advance the cursor to the newest message seen (by parsed time) PLUS the ids
  // at that exact timestamp, so the next scan re-fetches the boundary but skips
  // exactly what it already processed (see the filter above). Computed over the
  // full `fetched` set (including any boundary messages we skipped this run) so
  // the new boundary set is complete even when nothing new arrived. Only after
  // the loop completes without throwing: a mid-scan failure leaves the cursor put
  // so the next scan re-fetches and retries. Advancing even when everything was
  // ignored/deduped is the whole point — a noisy uncorrelated inbox must not
  // re-process the same mail every cron tick.
  const finiteTimes = fetched
    .map((m) => Date.parse(m.receivedAt))
    .filter((t) => Number.isFinite(t));
  if (finiteTimes.length > 0) {
    const newestMs = Math.max(...finiteTimes);
    const boundaryIds = fetched.filter((m) => Date.parse(m.receivedAt) === newestMs).map((m) => m.messageId);
    await deps.store.advanceScanCursor(new Date(newestMs).toISOString(), boundaryIds);
  }

  return result;
}
