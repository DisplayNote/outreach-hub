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
import { supabaseAmdStore, loadAttemptByCallControlId } from '@/lib/dialler/amd/store';
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
    if (!env.TELNYX_API_KEY || !env.TELNYX_CONNECTION_ID) {
      throw new AmdBackendError(
        'Telnyx backend requires TELNYX_API_KEY and TELNYX_CONNECTION_ID',
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
