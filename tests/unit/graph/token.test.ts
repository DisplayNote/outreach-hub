import { describe, it, expect, vi } from 'vitest';
import { resolveDelegatedToken } from '@/lib/graph/token';

const cfg = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  clientId: 'client-id',
  clientSecret: 'client-secret',
};

const NOW = 1_700_000_000_000; // fixed epoch ms
const now = () => NOW;

function tokenEndpointMock(response: { status?: number; body?: unknown; throws?: boolean }) {
  return vi.fn(async (_url: string, _init: RequestInit) => {
    if (response.throws) throw new Error('network down');
    return {
      ok: (response.status ?? 200) >= 200 && (response.status ?? 200) < 300,
      status: response.status ?? 200,
      json: async () => response.body,
    } as unknown as Response;
  });
}

describe('resolveDelegatedToken', () => {
  it('uses the stored token unchanged when it is still valid', async () => {
    const fetcher = tokenEndpointMock({ body: {} });
    const res = await resolveDelegatedToken(
      { accessToken: 'good', refreshToken: 'r', expiresAtMs: NOW + 10 * 60 * 1000 },
      cfg,
      { now, fetcher },
    );
    expect(res).toEqual({ kind: 'current', accessToken: 'good' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('treats a token inside the expiry skew as expired and refreshes', async () => {
    const fetcher = tokenEndpointMock({
      body: { access_token: 'fresh', refresh_token: 'r2', expires_in: 3600 },
    });
    const res = await resolveDelegatedToken(
      // expires in 30s — inside the 60s skew → must refresh
      { accessToken: 'old', refreshToken: 'r', expiresAtMs: NOW + 30 * 1000 },
      cfg,
      { now, fetcher },
    );
    expect(res.kind).toBe('refreshed');
    if (res.kind !== 'refreshed') throw new Error('unreachable');
    expect(res.tokens.accessToken).toBe('fresh');
    expect(res.tokens.refreshToken).toBe('r2');
    expect(res.tokens.expiresAt).toBe(Math.floor(NOW / 1000) + 3600);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('posts grant_type=refresh_token with the stored refresh token to the tenant endpoint', async () => {
    const fetcher = tokenEndpointMock({ body: { access_token: 'fresh', expires_in: 3600 } });
    await resolveDelegatedToken(
      { accessToken: null, refreshToken: 'the-refresh', expiresAtMs: null },
      cfg,
      { now, fetcher },
    );
    expect(fetcher).toHaveBeenCalledOnce();
    const call = fetcher.mock.calls[0]!;
    expect(call[0]).toBe(
      'https://login.microsoftonline.com/11111111-1111-1111-1111-111111111111/oauth2/v2.0/token',
    );
    const body = call[1].body as URLSearchParams;
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('the-refresh');
    expect(body.get('client_id')).toBe('client-id');
  });

  it('refreshes when there is no access token but a refresh token exists', async () => {
    const fetcher = tokenEndpointMock({ body: { access_token: 'fresh', expires_in: 3600 } });
    const res = await resolveDelegatedToken(
      { accessToken: null, refreshToken: 'r', expiresAtMs: null },
      cfg,
      { now, fetcher },
    );
    expect(res.kind).toBe('refreshed');
  });

  it('keeps the prior refresh token (null) when the endpoint omits a new one', async () => {
    const fetcher = tokenEndpointMock({ body: { access_token: 'fresh', expires_in: 3600 } });
    const res = await resolveDelegatedToken(
      { accessToken: 'old', refreshToken: 'r', expiresAtMs: NOW - 1000 },
      cfg,
      { now, fetcher },
    );
    if (res.kind !== 'refreshed') throw new Error('expected refresh');
    expect(res.tokens.refreshToken).toBeNull();
  });

  it('returns reauth when expired and no refresh token is stored', async () => {
    const fetcher = tokenEndpointMock({ body: {} });
    const res = await resolveDelegatedToken(
      { accessToken: 'old', refreshToken: null, expiresAtMs: NOW - 1000 },
      cfg,
      { now, fetcher },
    );
    expect(res).toEqual({ kind: 'reauth' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns reauth when the token endpoint responds non-2xx', async () => {
    const fetcher = tokenEndpointMock({ status: 400, body: { error: 'invalid_grant' } });
    const res = await resolveDelegatedToken(
      { accessToken: null, refreshToken: 'stale', expiresAtMs: null },
      cfg,
      { now, fetcher },
    );
    expect(res).toEqual({ kind: 'reauth' });
  });

  it('returns reauth when the token endpoint throws (network failure)', async () => {
    const fetcher = tokenEndpointMock({ throws: true });
    const res = await resolveDelegatedToken(
      { accessToken: null, refreshToken: 'r', expiresAtMs: null },
      cfg,
      { now, fetcher },
    );
    expect(res).toEqual({ kind: 'reauth' });
  });

  it('returns reauth when the refresh response lacks an access_token', async () => {
    const fetcher = tokenEndpointMock({ body: { refresh_token: 'r2', expires_in: 3600 } });
    const res = await resolveDelegatedToken(
      { accessToken: null, refreshToken: 'r', expiresAtMs: null },
      cfg,
      { now, fetcher },
    );
    expect(res).toEqual({ kind: 'reauth' });
  });

  it('sets expiresAt to null when the response omits expires_in', async () => {
    const fetcher = tokenEndpointMock({ body: { access_token: 'fresh' } });
    const res = await resolveDelegatedToken(
      { accessToken: null, refreshToken: 'r', expiresAtMs: null },
      cfg,
      { now, fetcher },
    );
    if (res.kind !== 'refreshed') throw new Error('expected refresh');
    expect(res.tokens.expiresAt).toBeNull();
  });
});
