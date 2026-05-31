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
  const attempt = await deps.loadAttempt(event.callControlId);
  if (!attempt) return null;

  const outcome = await applyEvent(deps.store, attempt, event, deps.now());

  for (const actuation of outcome.actuations) {
    if (actuation === 'hangup') {
      await deps.actuator.hangup(event.callControlId);
    } else {
      await deps.actuator.bridge(event.callControlId, deps.bridgeTarget);
    }
  }

  return outcome;
}
