import { describe, it, expect } from 'vitest';
import { parseTelnyxWebhook } from '@/lib/dialler/amd/parse';

function envelope(payload: Record<string, unknown>, eventType = 'call.answered'): string {
  return JSON.stringify({ data: { event_type: eventType, payload } });
}

describe('parseTelnyxWebhook', () => {
  it('maps a known event with call_control_id', () => {
    const ev = parseTelnyxWebhook(envelope({ call_control_id: 'cc1' }, 'call.ringing'));
    expect(ev).toMatchObject({ eventType: 'call.ringing', callControlId: 'cc1' });
  });

  it('extracts the AMD result on machine.detection.ended', () => {
    const ev = parseTelnyxWebhook(envelope({ call_control_id: 'cc1', result: 'machine' }, 'call.machine.detection.ended'));
    expect(ev?.result).toBe('machine');
  });

  it('extracts hangup_cause and custom headers', () => {
    const ev = parseTelnyxWebhook(
      envelope(
        {
          call_control_id: 'cc1',
          hangup_cause: 'normal_clearing',
          custom_headers: [
            { name: 'X-Hub-Attempt-Id', value: 'a1' },
            { name: 'X-Hub-Run-Id', value: 'r1' },
            { name: 'X-Hub-Contact-Id', value: 'c1' },
          ],
        },
        'call.hangup',
      ),
    );
    expect(ev?.hangupCause).toBe('normal_clearing');
    expect(ev?.customHeaders).toEqual({ attemptId: 'a1', runId: 'r1', contactId: 'c1' });
  });

  it('returns null for an unhandled event type (ignored)', () => {
    expect(parseTelnyxWebhook(envelope({ call_control_id: 'cc1' }, 'call.dtmf.received'))).toBeNull();
  });

  it('returns null for a missing call_control_id', () => {
    expect(parseTelnyxWebhook(envelope({}, 'call.answered'))).toBeNull();
  });

  it('returns null for malformed JSON without throwing', () => {
    expect(parseTelnyxWebhook('not json')).toBeNull();
  });
});
