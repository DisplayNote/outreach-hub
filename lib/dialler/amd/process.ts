/**
 * Processes one inbound call event end-to-end: load the attempt it belongs to,
 * {@link applyEvent} (state + event + auto-VM touchpoint), then actuate the
 * `hangup` / `bridge` the reducer asked for on the backend. Both the real Telnyx
 * webhook route and the mock backend feed events through this single function,
 * so they share identical behaviour (PHASE_4_SPEC §1/§7).
 *
 * Not pure (it does I/O) — the clock is injected as `now()` and all writes go
 * through the injected {@link AmdStore}, so it is still deterministic in tests.
 */
import { applyEvent, type AmdStore, type ApplyEventResult } from '@/lib/dialler/amd/apply';
import type { AmdDiallerBackend } from '@/lib/dialler/amd/backend';
import type { CallAttempt, TelnyxEvent } from '@/lib/dialler/amd/types';

export interface ProcessDeps {
  store: AmdStore;
  /** Resolve the attempt for an inbound event (by call_control_id). */
  loadAttempt(callControlId: string): Promise<CallAttempt | null>;
  /**
   * Fallback resolver by attempt id (from the event's custom headers), used when
   * a webhook arrives before `call_control_id` is persisted — otherwise the
   * event would be dropped and the call misclassified (e.g. a hangup logged as
   * no-answer because the AMD result never applied).
   */
  loadAttemptById(attemptId: string): Promise<CallAttempt | null>;
  /** Backend used to actuate hangup/bridge requested by the reducer. */
  actuator: Pick<AmdDiallerBackend, 'hangup' | 'bridge'>;
  /** Current time as an ISO string (injected for determinism). */
  now(): string;
  /** SIP URI the human leg is transferred to. */
  bridgeTarget: string;
}

/**
 * Returns the {@link ApplyEventResult}, or `null` when no attempt matches the
 * event (an unknown/stale call_control_id — ignored, like the legacy worker
 * ACKing unknown calls, worker.js L176–178).
 */
export async function processEvent(deps: ProcessDeps, event: TelnyxEvent): Promise<ApplyEventResult | null> {
  let attempt = await deps.loadAttempt(event.callControlId);
  if (!attempt && event.customHeaders?.attemptId) {
    // call_control_id not persisted yet — correlate by the attempt id carried in
    // the Telnyx custom headers so we don't drop early webhooks.
    attempt = await deps.loadAttemptById(event.customHeaders.attemptId);
  }
  if (!attempt) return null;

  const outcome = await applyEvent(deps.store, attempt, event, deps.now());

  // Actuate after persisting state. Persistence and actuation are not atomic, so
  // if an actuation throws the route returns 500 and Telnyx retries — but the
  // attempt's `actuated_at` is still null, so the reducer re-emits JUST the
  // actuation on the retry (at-least-once), and we only stamp `actuated_at` once
  // every actuation here has succeeded. (The mock actuates in-process.)
  for (const actuation of outcome.actuations) {
    if (actuation === 'hangup') {
      await deps.actuator.hangup(event.callControlId);
    } else {
      await deps.actuator.bridge(event.callControlId, deps.bridgeTarget);
    }
  }
  if (outcome.actuations.length > 0) {
    await deps.store.markActuated(attempt.id, deps.now());
  }

  return outcome;
}
