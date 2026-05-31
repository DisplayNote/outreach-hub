/**
 * Telnyx Call-Control webhook receiver (PHASE_4_SPEC §6) — the single public
 * endpoint Telnyx POSTs call events to. Verifies the Ed25519 signature, parses
 * the event, and drives it through the shared `processEvent` pipeline (load
 * attempt → applyEvent → actuate hangup/bridge).
 *
 * Signature gate (DECISION 6.1): when TELNYX_PUBLIC_KEY is set the signature
 * MUST verify; when it is unset the request is accepted only if the dev mock is
 * enabled (local + flag + loopback) — a deployed env without the key rejects all
 * traffic, so it can never process unsigned events. Node runtime: the verifier
 * uses node:crypto and writes go through the service-role client.
 */
import { NextResponse } from 'next/server';
import { getServerEnv, isDiallerMockEnabled } from '@/lib/env';
import { verifyTelnyxSignature } from '@/lib/dialler/amd/verify';
import { parseTelnyxWebhook } from '@/lib/dialler/amd/parse';
import { createAmdRuntime } from '@/lib/dialler/amd/runtime';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  const rawBody = await request.text();
  const env = getServerEnv();
  const publicKey = env.TELNYX_PUBLIC_KEY;

  if (publicKey) {
    const signature = request.headers.get('telnyx-signature-ed25519') ?? '';
    const timestamp = request.headers.get('telnyx-timestamp') ?? '';
    const verified = verifyTelnyxSignature(
      rawBody,
      { signature, timestamp },
      publicKey,
      Math.floor(Date.now() / 1000),
    );
    if (!verified) {
      return new NextResponse('invalid signature', { status: 401 });
    }
  } else if (!isDiallerMockEnabled()) {
    // No key and not the dev mock — refuse unsigned traffic.
    return new NextResponse('signature verification not configured', { status: 401 });
  }

  const event = parseTelnyxWebhook(rawBody);
  // Unhandled/ignored event types ACK with 200 so Telnyx does not retry them.
  if (!event) return new NextResponse('OK', { status: 200 });

  try {
    const { process } = createAmdRuntime();
    await process(event);
  } catch (cause) {
    // A processing failure returns a controlled 500 (not an uncaught 5xx) so
    // Telnyx retries — safe because the reducer is idempotent for at-least-once
    // delivery (duplicate events are no-ops once the attempt is terminal).
    console.error('telnyx webhook processing failed', { eventType: event.eventType, cause });
    return new NextResponse('processing error', { status: 500 });
  }
  return new NextResponse('OK', { status: 200 });
}
