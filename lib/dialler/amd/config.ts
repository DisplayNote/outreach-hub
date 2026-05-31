/**
 * Builds the Telnyx Call-Control dial payload with Premium AMD enabled.
 *
 * Ported verbatim from the legacy Cloudflare Worker (legacy/worker.js L82–104):
 * the `answering_machine_detection_config` tuning, the `timeout_secs` derived
 * from the no-answer timeout, and the `custom_headers` that carry our
 * correlation ids back through every webhook so a handler with no in-memory
 * context can recover them (PHASE_4_SPEC §5). Pure — no I/O, no clock.
 */

/** Telnyx AMD profile (worker.js L78). `premium` is the project default. */
export type AmdMode = 'premium' | 'detect' | 'detect_beep';

export interface BuildDialPayloadInput {
  /** Normalised E.164 destination. */
  to: string;
  /** Outbound CLI (E.164). */
  from: string;
  /** Telnyx Call Control Application connection id. */
  connectionId: string;
  attemptId: string;
  runId: string;
  contactId: string;
  amdMode: AmdMode;
  /** No-answer ring timeout in ms; converted up to whole seconds. */
  noAnswerMs: number;
}

export interface TelnyxCustomHeader {
  name: string;
  value: string;
}

export interface TelnyxDialPayload {
  connection_id: string;
  to: string;
  from: string;
  answering_machine_detection: AmdMode;
  answering_machine_detection_config: {
    total_analysis_time_millis: number;
    greeting_total_analysis_time_millis: number;
    after_greeting_silence_millis: number;
    between_words_silence_millis: number;
    greeting_duration_millis: number;
    initial_silence_millis: number;
    maximum_number_of_words: number;
    maximum_word_length_millis: number;
    silence_threshold: number;
  };
  timeout_secs: number;
  custom_headers: TelnyxCustomHeader[];
}

export function buildDialPayload(input: BuildDialPayloadInput): TelnyxDialPayload {
  return {
    connection_id: input.connectionId,
    to: input.to,
    from: input.from,
    answering_machine_detection: input.amdMode,
    answering_machine_detection_config: {
      total_analysis_time_millis: 6000,
      greeting_total_analysis_time_millis: 5000,
      after_greeting_silence_millis: 800,
      between_words_silence_millis: 100,
      greeting_duration_millis: 3500,
      initial_silence_millis: 3500,
      maximum_number_of_words: 5,
      maximum_word_length_millis: 3500,
      silence_threshold: 512,
    },
    timeout_secs: Math.ceil(input.noAnswerMs / 1000),
    custom_headers: [
      { name: 'X-Hub-Attempt-Id', value: input.attemptId },
      { name: 'X-Hub-Run-Id', value: input.runId },
      { name: 'X-Hub-Contact-Id', value: input.contactId },
    ],
  };
}
