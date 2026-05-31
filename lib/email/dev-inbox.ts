/**
 * Process-global dev inbox (PHASE_5_SPEC §9). The "Simulate reply/bounce"
 * affordance pushes here; the mock driver's `fetchReplies` merges it. A module
 * global persists across HTTP requests within one `next dev` process, so a
 * simulate (one request) is visible to a later scan (another request) — without
 * which the in-memory MockDriver instance state wouldn't survive between calls.
 *
 * Dev-only: writes are gated by isEmailMockEnabled() at the call site. Unit
 * tests don't touch this queue, so it stays empty and never affects them.
 */
import type { InboundMessage } from '@/lib/email/types';

const queue: InboundMessage[] = [];

export function pushDevInbound(message: InboundMessage): void {
  queue.push(message);
}

export function devInboundSince(since: string): InboundMessage[] {
  const sinceMs = Date.parse(since);
  return queue.filter((m) => Number.isNaN(sinceMs) || Date.parse(m.receivedAt) >= sinceMs);
}

export function clearDevInbox(): void {
  queue.length = 0;
}
