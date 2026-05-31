/**
 * Wires the AMD runtime: the service-role store, the attempt loader, the chosen
 * backend (mock vs real), and the {@link processEvent} closure that the webhook
 * route and the mock backend both drive. Resolving the backend + process
 * together here handles their mutual reference (the backend's actuations call
 * back into processEvent; processEvent's actuator is the backend).
 *
 * `getAmdBackend()` returns the mock only when {@link isDiallerMockEnabled}
 * (dev + flag + loopback); otherwise the real {@link TelnyxAmdBackend}, which
 * requires the Telnyx env to be set.
 */
import { getServerEnv, isDiallerMockEnabled } from '@/lib/env';
import { createServiceClient } from '@/lib/supabase/service';
import { supabaseAmdStore, loadAttemptByCallControlId, loadAttemptById } from '@/lib/dialler/amd/store';
import { processEvent, type ProcessDeps } from '@/lib/dialler/amd/process';
import { MockTelnyxBackend } from '@/lib/dialler/amd/mock-backend';
import { TelnyxAmdBackend } from '@/lib/dialler/amd/telnyx-backend';
import { AmdBackendError, type TelnyxEvent } from '@/lib/dialler/amd/types';
import type { AmdDiallerBackend } from '@/lib/dialler/amd/backend';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface AmdRuntime {
  backend: AmdDiallerBackend;
  /** Feed an inbound event through load → apply → actuate. */
  process: (event: TelnyxEvent) => Promise<void>;
  client: SupabaseClient;
}

export function createAmdRuntime(): AmdRuntime {
  const env = getServerEnv();
  const client = createServiceClient();
  const store = supabaseAmdStore(client);

  // `backend` is assigned just below; the actuator closure reads it lazily at
  // call time, so the mutual reference is safe.
  let backend: AmdDiallerBackend;

  const deps: ProcessDeps = {
    store,
    loadAttempt: (callControlId) => loadAttemptByCallControlId(client, callControlId),
    loadAttemptById: (attemptId) => loadAttemptById(client, attemptId),
    actuator: {
      hangup: (id) => backend.hangup(id),
      bridge: (id, target) => backend.bridge(id, target),
    },
    now: () => new Date().toISOString(),
    bridgeTarget: env.BRIDGE_SIP_USERNAME ? `sip:${env.BRIDGE_SIP_USERNAME}@sip.telnyx.com` : '',
  };

  const process = (event: TelnyxEvent): Promise<void> => processEvent(deps, event).then(() => undefined);

  if (isDiallerMockEnabled()) {
    backend = new MockTelnyxBackend({ process });
  } else {
    if (!env.TELNYX_API_KEY || !env.TELNYX_CONNECTION_ID || !env.BRIDGE_SIP_USERNAME || !env.TELNYX_PUBLIC_KEY) {
      // All four are required for a working real backend:
      // - BRIDGE_SIP_USERNAME: a human AMD result transfers to this SIP target;
      //   an empty target always fails (stuck attempt / Telnyx retries).
      // - TELNYX_PUBLIC_KEY: without it the webhook route rejects every inbound
      //   event (401), so calls are placed but never progress and can leak.
      throw new AmdBackendError(
        'Telnyx backend requires TELNYX_API_KEY, TELNYX_CONNECTION_ID, BRIDGE_SIP_USERNAME and TELNYX_PUBLIC_KEY',
        undefined,
        'TELNYX_CONFIG',
      );
    }
    backend = new TelnyxAmdBackend({
      apiKey: env.TELNYX_API_KEY,
      connectionId: env.TELNYX_CONNECTION_ID,
      amdMode: env.AMD_MODE,
      noAnswerMs: env.NO_ANSWER_TIMEOUT_MS,
    });
  }

  return { backend, process, client };
}
