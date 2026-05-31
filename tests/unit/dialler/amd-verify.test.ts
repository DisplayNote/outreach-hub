import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { verifyTelnyxSignature } from '@/lib/dialler/amd/verify';

/**
 * Telnyx signs `${timestamp}|${rawBody}` with Ed25519 and sends the signature
 * (base64) in `Telnyx-Signature-Ed25519` and the unix-seconds in
 * `Telnyx-Timestamp`. We verify against the account's base64 public key.
 */
let publicKeyB64: string;
let privateKey: KeyObject;

const NOW = 1_750_000_000; // fixed "now" in unix seconds — no Date.now() in the function
const RAW_BODY = '{"data":{"event_type":"call.answered"}}';

function signature(timestamp: number, body: string, key: KeyObject = privateKey): string {
  return sign(null, Buffer.from(`${timestamp}|${body}`), key).toString('base64');
}

beforeAll(() => {
  const { publicKey, privateKey: priv } = generateKeyPairSync('ed25519');
  privateKey = priv;
  publicKeyB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
});

describe('verifyTelnyxSignature', () => {
  it('accepts a valid, fresh signature', () => {
    const ts = NOW;
    expect(
      verifyTelnyxSignature(RAW_BODY, { signature: signature(ts, RAW_BODY), timestamp: String(ts) }, publicKeyB64, NOW),
    ).toBe(true);
  });

  it('rejects a tampered body', () => {
    const ts = NOW;
    expect(
      verifyTelnyxSignature(
        '{"data":{"event_type":"call.hangup"}}',
        { signature: signature(ts, RAW_BODY), timestamp: String(ts) },
        publicKeyB64,
        NOW,
      ),
    ).toBe(false);
  });

  it('rejects a stale timestamp (older than tolerance)', () => {
    const ts = NOW - 600; // 10 min old, tolerance default 300s
    expect(
      verifyTelnyxSignature(RAW_BODY, { signature: signature(ts, RAW_BODY), timestamp: String(ts) }, publicKeyB64, NOW),
    ).toBe(false);
  });

  it('rejects a signature made with a different key', () => {
    const { privateKey: otherKey } = generateKeyPairSync('ed25519');
    const ts = NOW;
    expect(
      verifyTelnyxSignature(
        RAW_BODY,
        { signature: signature(ts, RAW_BODY, otherKey), timestamp: String(ts) },
        publicKeyB64,
        NOW,
      ),
    ).toBe(false);
  });

  it('rejects malformed input without throwing', () => {
    expect(verifyTelnyxSignature(RAW_BODY, { signature: 'not-base64!!', timestamp: 'abc' }, publicKeyB64, NOW)).toBe(
      false,
    );
  });
});
