/**
 * Real Telnyx Call-Control backend (PHASE_4_SPEC §6). Ports the legacy Worker's
 * API calls (legacy/worker.js: dial L106, hangup L154, transfer L284, the
 * `telnyxAPI` helper L360–370) onto the {@link AmdDiallerBackend} interface.
 *
 * `fetch` is injected so it can be unit-tested without a network; in production
 * it defaults to the global fetch. This path is only exercised when real Telnyx
 * credentials are configured — local/CI runs use {@link MockTelnyxBackend}.
 */
import { buildDialPayload, type AmdMode } from '@/lib/dialler/amd/config';
import { AmdBackendError } from '@/lib/dialler/amd/types';
import type { AmdDiallerBackend, PlaceCallOptions } from '@/lib/dialler/amd/backend';

const TELNYX_API_BASE = 'https://api.telnyx.com';

export interface TelnyxBackendConfig {
  apiKey: string;
  connectionId: string;
  amdMode: AmdMode;
  noAnswerMs: number;
}

export class TelnyxAmdBackend implements AmdDiallerBackend {
  readonly name = 'telnyx';

  constructor(
    private readonly config: TelnyxBackendConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async placeCall(opts: PlaceCallOptions): Promise<{ callControlId: string }> {
    const payload = buildDialPayload({
      to: opts.to,
      from: opts.from,
      connectionId: this.config.connectionId,
      attemptId: opts.attemptId,
      runId: opts.runId,
      contactId: opts.contactId,
      amdMode: this.config.amdMode,
      noAnswerMs: this.config.noAnswerMs,
    });
    const data = await this.call('POST', '/v2/calls', payload);
    const callControlId = (data as { data?: { call_control_id?: string } }).data?.call_control_id;
    if (!callControlId) {
      throw new AmdBackendError('Telnyx dial returned no call_control_id', undefined, 'TELNYX_NO_CCID');
    }
    return { callControlId };
  }

  async hangup(callControlId: string): Promise<void> {
    await this.call('POST', `/v2/calls/${callControlId}/actions/hangup`, {});
  }

  async bridge(callControlId: string, target: string): Promise<void> {
    await this.call('POST', `/v2/calls/${callControlId}/actions/transfer`, { to: target });
  }

  private async call(method: string, path: string, body: unknown): Promise<unknown> {
    let resp: Response;
    try {
      resp = await this.fetchImpl(`${TELNYX_API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body ?? {}),
      });
    } catch (cause) {
      throw new AmdBackendError(`Telnyx ${method} ${path} request failed`, cause, 'TELNYX_NETWORK');
    }
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new AmdBackendError(
        `Telnyx ${method} ${path} failed (${resp.status}): ${detail}`,
        undefined,
        'TELNYX_HTTP',
      );
    }
    return resp.json();
  }
}
