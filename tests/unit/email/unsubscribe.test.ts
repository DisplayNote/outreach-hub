import { describe, it, expect } from 'vitest';
import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribe,
  getUnsubscribeConfig,
} from '@/lib/email/unsubscribe';

const SECRET = 'test-secret-please-rotate';
const ORG = '11111111-1111-1111-1111-111111111111';

describe('unsubscribe tokens', () => {
  it('round-trips orgId + normalised email', () => {
    const token = signUnsubscribeToken(ORG, '  Alice@Corp.com ', SECRET);
    expect(verifyUnsubscribeToken(token, SECRET)).toEqual({ orgId: ORG, email: 'alice@corp.com' });
  });

  it('rejects a token signed with a different secret', () => {
    const token = signUnsubscribeToken(ORG, 'a@corp.com', SECRET);
    expect(verifyUnsubscribeToken(token, 'other-secret')).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const token = signUnsubscribeToken(ORG, 'a@corp.com', SECRET);
    const [payload, sig] = token.split('.');
    // Re-encode a different email under the same (now wrong) signature.
    const forged = `${Buffer.from(`${ORG}:evil@corp.com`).toString('base64url')}.${sig}`;
    expect(forged).not.toEqual(token);
    expect(verifyUnsubscribeToken(forged, SECRET)).toBeNull();
    // Sanity: the original still verifies.
    expect(payload).toBeTruthy();
    expect(verifyUnsubscribeToken(token, SECRET)).not.toBeNull();
  });

  it('rejects malformed tokens', () => {
    for (const bad of ['', 'no-dot', '.', 'a.', '.b', 'not base64!.sig']) {
      expect(verifyUnsubscribeToken(bad, SECRET)).toBeNull();
    }
  });

  it('builds an absolute URL + List-Unsubscribe headers', () => {
    const { url, headers } = buildUnsubscribe(ORG, 'a@corp.com', { baseUrl: 'https://app.test', secret: SECRET });
    expect(url.startsWith('https://app.test/api/unsubscribe?token=')).toBe(true);
    expect(headers['List-Unsubscribe']).toBe(`<${url}>`);
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    // The URL's token verifies back to the recipient.
    const token = decodeURIComponent(url.split('token=')[1]!);
    expect(verifyUnsubscribeToken(token, SECRET)).toEqual({ orgId: ORG, email: 'a@corp.com' });
  });
});

describe('getUnsubscribeConfig', () => {
  it('returns null unless both APP_BASE_URL and UNSUBSCRIBE_SECRET are set', () => {
    expect(getUnsubscribeConfig({})).toBeNull();
    expect(getUnsubscribeConfig({ APP_BASE_URL: 'https://app.test' })).toBeNull();
    expect(getUnsubscribeConfig({ UNSUBSCRIBE_SECRET: 's' })).toBeNull();
  });

  it('strips a trailing slash from the base URL', () => {
    expect(getUnsubscribeConfig({ APP_BASE_URL: 'https://app.test/', UNSUBSCRIBE_SECRET: 's' })).toEqual({
      baseUrl: 'https://app.test',
      secret: 's',
    });
  });
});
