import { describe, it, expect } from 'vitest';
import { buildDialPayload } from '@/lib/dialler/amd/config';

describe('buildDialPayload', () => {
  const base = {
    to: '+447700900001',
    from: '+441234567890',
    connectionId: 'cc-123',
    attemptId: 'a1',
    runId: 'r1',
    contactId: 'c1',
    amdMode: 'premium' as const,
    noAnswerMs: 22000,
  };

  it('sets the destination, origin and connection', () => {
    const p = buildDialPayload(base);
    expect(p.to).toBe('+447700900001');
    expect(p.from).toBe('+441234567890');
    expect(p.connection_id).toBe('cc-123');
  });

  it('enables premium AMD with the analysis config (worker.js L86–97)', () => {
    const p = buildDialPayload(base);
    expect(p.answering_machine_detection).toBe('premium');
    expect(p.answering_machine_detection_config).toEqual({
      total_analysis_time_millis: 6000,
      greeting_total_analysis_time_millis: 5000,
      after_greeting_silence_millis: 800,
      between_words_silence_millis: 100,
      greeting_duration_millis: 3500,
      initial_silence_millis: 3500,
      maximum_number_of_words: 5,
      maximum_word_length_millis: 3500,
      silence_threshold: 512,
    });
  });

  it('derives timeout_secs by rounding noAnswerMs up to whole seconds', () => {
    expect(buildDialPayload(base).timeout_secs).toBe(22);
    expect(buildDialPayload({ ...base, noAnswerMs: 22500 }).timeout_secs).toBe(23);
  });

  it('carries the correlation ids as custom headers', () => {
    const p = buildDialPayload(base);
    expect(p.custom_headers).toEqual([
      { name: 'X-Hub-Attempt-Id', value: 'a1' },
      { name: 'X-Hub-Run-Id', value: 'r1' },
      { name: 'X-Hub-Contact-Id', value: 'c1' },
    ]);
  });
});
