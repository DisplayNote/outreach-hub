/**
 * The server-side AMD control plane (PHASE_4_SPEC §5). Implemented by
 * {@link TelnyxAmdBackend} (real Call-Control API) and {@link MockTelnyxBackend}
 * (in-process simulation). Selected by `createAmdRuntime()` (see runtime.ts),
 * which returns the mock only when {@link isDiallerMockEnabled} (dev + flag +
 * loopback).
 *
 * The browser never calls these — they run inside Server Actions / the webhook
 * route. `placeCall`/`hangup`/`bridge` are app→Telnyx calls; the lifecycle comes
 * back as webhooks (real) or scheduled events (mock) and is applied by
 * `processEvent`.
 */
import type { AmdScenario } from '@/lib/dialler/amd/types';

export interface PlaceCallOptions {
  /** Normalised E.164 destination. */
  to: string;
  /** Outbound CLI (E.164). */
  from: string;
  attemptId: string;
  runId: string;
  contactId: string;
  /** Mock-only: force a simulated outcome. Ignored by the real backend. */
  scenario?: AmdScenario;
}

export interface AmdDiallerBackend {
  readonly name: string;
  /** Start an AMD call; resolves with the Telnyx call_control_id. */
  placeCall(opts: PlaceCallOptions): Promise<{ callControlId: string }>;
  /** Hang up a live call. */
  hangup(callControlId: string): Promise<void>;
  /** Transfer the answered (human) leg to the bridge target. */
  bridge(callControlId: string, target: string): Promise<void>;
}
