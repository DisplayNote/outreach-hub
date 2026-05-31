/**
 * Ed25519 verification of Telnyx Call-Control webhooks (PHASE_4_SPEC §6).
 *
 * Telnyx signs `${timestamp}|${rawBody}` with Ed25519 and sends:
 *   - `Telnyx-Signature-Ed25519`: the signature, base64
 *   - `Telnyx-Timestamp`: unix seconds
 * We verify against the account's public key (base64 SPKI/DER, the
 * `TELNYX_PUBLIC_KEY` env). This replaces the legacy Worker's "trust by URL
 * obscurity" (worker.js L166–167).
 *
 * Pure: `now` (unix seconds) is passed in so there is no `Date.now()` here — the
 * caller supplies the clock, keeping the function deterministic and testable.
 * Never throws — any malformed input returns `false`.
 */
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

export interface TelnyxSignatureHeaders {
  /** base64 Ed25519 signature (Telnyx-Signature-Ed25519). */
  signature: string;
  /** unix seconds as a string (Telnyx-Timestamp). */
  timestamp: string;
}

const DEFAULT_TOLERANCE_SEC = 300;

export function verifyTelnyxSignature(
  rawBody: string,
  headers: TelnyxSignatureHeaders,
  publicKeyBase64: string,
  now: number,
  toleranceSec: number = DEFAULT_TOLERANCE_SEC,
): boolean {
  try {
    const ts = Number(headers.timestamp);
    if (!Number.isFinite(ts)) return false;
    if (Math.abs(now - ts) > toleranceSec) return false;

    const publicKey = createPublicKey({
      key: Buffer.from(publicKeyBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });

    const signature = Buffer.from(headers.signature, 'base64');
    const signedPayload = Buffer.from(`${headers.timestamp}|${rawBody}`);
    return cryptoVerify(null, signedPayload, publicKey, signature);
  } catch {
    return false;
  }
}
