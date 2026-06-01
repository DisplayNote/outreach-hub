import { describe, it, expect } from 'vitest';
import { authorizeCron } from '@/lib/cron-auth';

function req(headers: Record<string, string>): Request {
  return new Request('https://x/api/email/run', { headers });
}

describe('authorizeCron', () => {
  const secret = 's3cret-value';

  it('accepts a correct Authorization: Bearer <secret>', () => {
    expect(authorizeCron(req({ authorization: `Bearer ${secret}` }), secret)).toBe(true);
  });
  it('accepts a correct x-cron-secret header', () => {
    expect(authorizeCron(req({ 'x-cron-secret': secret }), secret)).toBe(true);
  });
  it('rejects a wrong secret (and a prefix of it)', () => {
    expect(authorizeCron(req({ authorization: `Bearer wrong` }), secret)).toBe(false);
    expect(authorizeCron(req({ 'x-cron-secret': 's3cret' }), secret)).toBe(false);
  });
  it('rejects when no header is provided', () => {
    expect(authorizeCron(req({}), secret)).toBe(false);
  });
  it('refuses when no secret is configured (never run unauthenticated)', () => {
    expect(authorizeCron(req({ authorization: 'Bearer anything' }), undefined)).toBe(false);
    expect(authorizeCron(req({ authorization: 'Bearer ' }), '')).toBe(false);
  });
});
