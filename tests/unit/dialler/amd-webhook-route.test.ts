import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';

// Mocked deps: env (gate) + runtime (capture process). verify + parse are real.
const getServerEnv = vi.fn();
const isDiallerMockEnabled = vi.fn();
const processSpy = vi.fn(async (_event: unknown) => undefined);

vi.mock('@/lib/env', () => ({
  getServerEnv: () => getServerEnv(),
  isDiallerMockEnabled: () => isDiallerMockEnabled(),
}));
vi.mock('@/lib/dialler/amd/runtime', () => ({
  createAmdRuntime: () => ({ process: processSpy, backend: { name: 'mock' }, client: {} }),
}));

const { POST } = await import('@/app/api/telnyx/webhook/route');

const body = JSON.stringify({ data: { event_type: 'call.ringing', payload: { call_control_id: 'cc1' } } });

function req(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/telnyx/webhook', { method: 'POST', body, headers });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/telnyx/webhook', () => {
  it('accepts an unsigned event in dev mock mode and processes it', async () => {
    getServerEnv.mockReturnValue({ TELNYX_PUBLIC_KEY: undefined });
    isDiallerMockEnabled.mockReturnValue(true);

    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(processSpy).toHaveBeenCalledOnce();
    expect(processSpy.mock.calls[0]![0]).toMatchObject({ eventType: 'call.ringing', callControlId: 'cc1' });
  });

  it('rejects an unsigned event when not in mock mode and no key', async () => {
    getServerEnv.mockReturnValue({ TELNYX_PUBLIC_KEY: undefined });
    isDiallerMockEnabled.mockReturnValue(false);

    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(processSpy).not.toHaveBeenCalled();
  });

  it('accepts a validly-signed event when a public key is configured', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const publicKeyB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    getServerEnv.mockReturnValue({ TELNYX_PUBLIC_KEY: publicKeyB64 });
    isDiallerMockEnabled.mockReturnValue(false);

    const ts = String(Math.floor(Date.now() / 1000));
    const signature = sign(null, Buffer.from(`${ts}|${body}`), privateKey).toString('base64');

    const res = await POST(req({ 'telnyx-signature-ed25519': signature, 'telnyx-timestamp': ts }));
    expect(res.status).toBe(200);
    expect(processSpy).toHaveBeenCalledOnce();
  });

  it('rejects a tampered signature (401, no processing)', async () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const publicKeyB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    getServerEnv.mockReturnValue({ TELNYX_PUBLIC_KEY: publicKeyB64 });
    isDiallerMockEnabled.mockReturnValue(false);

    const ts = String(Math.floor(Date.now() / 1000));
    const res = await POST(req({ 'telnyx-signature-ed25519': 'AAAA', 'telnyx-timestamp': ts }));
    expect(res.status).toBe(401);
    expect(processSpy).not.toHaveBeenCalled();
  });
});
