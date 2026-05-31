/**
 * Parses a raw Telnyx Call-Control webhook body into the normalised
 * {@link TelnyxEvent} the reducer consumes (worker.js L168–172 envelope shape).
 * Pure and total — returns `null` for malformed JSON, a missing
 * `call_control_id`, or an event type we don't act on (which the route ACKs and
 * ignores, like the legacy worker). Never throws.
 */
import { asAmdResult, type TelnyxEvent, type TelnyxEventType } from '@/lib/dialler/amd/types';

const HANDLED: ReadonlySet<string> = new Set<TelnyxEventType>([
  'call.initiated',
  'call.ringing',
  'call.answered',
  'call.machine.detection.ended',
  'call.hangup',
]);

interface RawCustomHeader {
  name?: unknown;
  value?: unknown;
}

function readHeaders(raw: unknown): TelnyxEvent['customHeaders'] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: { attemptId?: string; runId?: string; contactId?: string } = {};
  for (const h of raw as RawCustomHeader[]) {
    if (typeof h?.name !== 'string' || typeof h?.value !== 'string') continue;
    if (h.name === 'X-Hub-Attempt-Id') out.attemptId = h.value;
    else if (h.name === 'X-Hub-Run-Id') out.runId = h.value;
    else if (h.name === 'X-Hub-Contact-Id') out.contactId = h.value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function parseTelnyxWebhook(rawBody: string): TelnyxEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }

  const data = (parsed as { data?: { event_type?: unknown; payload?: Record<string, unknown> } })?.data;
  const eventType = data?.event_type;
  if (typeof eventType !== 'string' || !HANDLED.has(eventType)) return null;

  const payload = data?.payload ?? {};
  const callControlId = payload.call_control_id;
  if (typeof callControlId !== 'string' || callControlId === '') return null;

  const event: TelnyxEvent = {
    eventType: eventType as TelnyxEventType,
    callControlId,
  };
  // Whitelist the AMD result; ignore unknown/new values rather than persisting
  // an unsound amd_result (an unrecognised value just leaves result unset).
  const result = asAmdResult(payload.result);
  if (result !== null) event.result = result;
  if (typeof payload.hangup_cause === 'string') event.hangupCause = payload.hangup_cause;
  const headers = readHeaders(payload.custom_headers);
  if (headers !== undefined) event.customHeaders = headers;

  return event;
}
