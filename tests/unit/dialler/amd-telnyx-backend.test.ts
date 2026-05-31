import { describe, it, expect, vi } from 'vitest';
import { TelnyxAmdBackend } from '@/lib/dialler/amd/telnyx-backend';

const config = {
  apiKey: 'KEY123',
  connectionId: 'cc-app',
  amdMode: 'premium' as const,
  noAnswerMs: 22000,
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

const placeArgs = { to: '+447700900001', from: '+441234567890', attemptId: 'a1', runId: 'r1', contactId: 'c1' };

describe('TelnyxAmdBackend', () => {
  it('placeCall POSTs /v2/calls with the AMD payload + bearer and returns call_control_id', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ data: { call_control_id: 'tcc-1' } }));
    const backend = new TelnyxAmdBackend(config, fetchImpl as unknown as typeof fetch);

    const out = await backend.placeCall(placeArgs);
    expect(out.callControlId).toBe('tcc-1');

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.telnyx.com/v2/calls');
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer KEY123');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.answering_machine_detection).toBe('premium');
    expect(body.to).toBe('+447700900001');
    expect(body.connection_id).toBe('cc-app');
  });

  it('hangup POSTs the hangup action', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ data: {} }));
    const backend = new TelnyxAmdBackend(config, fetchImpl as unknown as typeof fetch);
    await backend.hangup('tcc-1');
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.telnyx.com/v2/calls/tcc-1/actions/hangup');
  });

  it('bridge POSTs the transfer action with the SIP target', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ data: {} }));
    const backend = new TelnyxAmdBackend(config, fetchImpl as unknown as typeof fetch);
    await backend.bridge('tcc-1', 'sip:rep@sip.telnyx.com');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.telnyx.com/v2/calls/tcc-1/actions/transfer');
    expect(JSON.parse((init as RequestInit).body as string).to).toBe('sip:rep@sip.telnyx.com');
  });

  it('throws AmdBackendError on a non-ok response', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ errors: [{ detail: 'bad' }] }, false, 422));
    const backend = new TelnyxAmdBackend(config, fetchImpl as unknown as typeof fetch);
    await expect(backend.placeCall(placeArgs)).rejects.toThrow(/telnyx/i);
  });
});
