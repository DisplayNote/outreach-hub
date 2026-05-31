'use client';

/**
 * AMD ("Mode B") run controller (PHASE_4_SPEC §8).
 *
 * Starts a run, then dials the queue ONE contact at a time (the sequential
 * invariant the server also enforces). Each attempt's state arrives over
 * Realtime via {@link useAmdRun} — the browser never drives the lifecycle, it
 * observes it. The server auto-logs the voicemail touchpoint on a machine and
 * auto-hangs-up; on a detected human the attempt reaches `bridged` and we hand
 * off to the rep, who logs the outcome through the same `logCallOutcome` action
 * the Phase-3 click-to-call uses. Non-bridged outcomes auto-advance after a
 * short delay; a bridged call waits for the rep.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { logCallOutcome, type CallOutcomeKey } from '@/lib/actions/dialler';
import { getDiallerOutcomes } from '@/lib/dialler';
import { startAmdRun, placeAmdCall, hangupAttempt, cancelAttempt, setRunStatus } from '@/lib/actions/dialler-amd';
import { useAmdRun } from '@/lib/dialler/amd/realtime';
import type { CallAttempt, CallAttemptState } from '@/lib/dialler/amd/types';
import type { DiallerQueueItem } from '@/components/dialler-run';

export interface AmdRunProps {
  queue: readonly DiallerQueueItem[];
  /** Pause between attempts (ms), from org settings; defaults to 3s. */
  callDelayMs?: number;
}

const NON_TERMINAL: ReadonlySet<CallAttemptState> = new Set<CallAttemptState>([
  'queued',
  'dialing',
  'ringing',
  'answered',
]);

function liveLabel(a: CallAttempt | undefined): string {
  if (!a) return 'Queued';
  switch (a.state) {
    case 'queued':
      return 'Queued';
    case 'dialing':
      return 'Dialling…';
    case 'ringing':
      return 'Ringing…';
    case 'answered':
      return 'Answered — AMD analysing…';
    case 'machine':
      return 'Voicemail — auto-logging…';
    case 'bridged':
      return 'Human — connecting you…';
    case 'failed':
      return 'Failed';
    case 'ended':
      switch (a.disposition) {
        case 'voicemail-auto':
          return 'Voicemail (auto-logged)';
        case 'bridged-human':
          return 'Conversation logged';
        case 'no-answer':
          return 'No answer';
        case 'cancelled':
          return 'Skipped';
        default:
          return 'Ended';
      }
  }
}

const card: React.CSSProperties = {
  marginTop: '1.5rem',
  padding: '1.5rem',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  background: '#fff',
};
const primaryBtn: React.CSSProperties = {
  padding: '0.6rem 1.4rem',
  background: '#111',
  color: '#fff',
  border: '1px solid #111',
  borderRadius: 6,
  fontSize: '0.95rem',
  fontWeight: 600,
  cursor: 'pointer',
};
const secondaryBtn: React.CSSProperties = {
  padding: '0.5rem 1rem',
  background: '#fff',
  color: '#374151',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: '0.9rem',
  cursor: 'pointer',
};
const outcomeBtn: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '0.7rem 0.9rem',
  background: '#f9fafb',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: '0.9375rem',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

export default function AmdRun({ queue, callDelayMs = 3000 }: AmdRunProps) {
  const outcomes = useMemo(() => getDiallerOutcomes(), []);
  const total = queue.length;

  const [runId, setRunId] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [currentAttemptId, setCurrentAttemptId] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [recording, setRecording] = useState<CallOutcomeKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const placedForIndex = useRef<number>(-1);
  const { attempts } = useAmdRun(runId);

  const current = index < total ? queue[index] : undefined;
  const done = runId !== null && index >= total;
  const currentAttempt = currentAttemptId ? attempts[currentAttemptId] : undefined;

  // A human bridge needs the rep to log an outcome. Derived (not stored) so it
  // stays true across the mock's bridged→ended transition until we advance, and
  // so we never call setState synchronously inside an effect.
  const awaitOutcome =
    !!currentAttempt && (currentAttempt.state === 'bridged' || currentAttempt.disposition === 'bridged-human');

  const tally = useMemo(() => {
    let voicemails = 0;
    let humans = 0;
    let noAnswers = 0;
    for (const a of Object.values(attempts)) {
      if (a.disposition === 'voicemail-auto') voicemails += 1;
      else if (a.disposition === 'bridged-human') humans += 1;
      else if (a.disposition === 'no-answer') noAnswers += 1;
    }
    return { voicemails, humans, noAnswers };
  }, [attempts]);

  const start = useCallback(async () => {
    setError(null);
    try {
      const { id } = await startAmdRun();
      setRunId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the run');
    }
  }, []);

  const advance = useCallback(() => {
    setCurrentAttemptId(null);
    setIndex((i) => i + 1);
  }, []);

  // Place the next call when idle (sequential; guarded against double-place).
  useEffect(() => {
    if (runId === null || paused || done || awaitOutcome) return;
    if (currentAttemptId !== null || !current) return;
    if (placedForIndex.current === index) return;
    placedForIndex.current = index;

    let cancelled = false;
    void (async () => {
      try {
        const { attemptId } = await placeAmdCall({ runId, contactId: current.id });
        if (!cancelled) setCurrentAttemptId(attemptId);
      } catch (e) {
        // A dial failure (e.g. fail-scenario / no number) shouldn't stall the run.
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Dial failed');
          advance();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId, paused, done, awaitOutcome, currentAttemptId, current, index, advance]);

  // Auto-advance terminal, non-human attempts after the inter-call delay. A
  // bridged (human) call waits for the rep to record an outcome instead.
  useEffect(() => {
    if (!currentAttempt) return;
    const terminal = currentAttempt.state === 'ended' || currentAttempt.state === 'failed';
    if (terminal && currentAttempt.disposition !== 'bridged-human') {
      const t = setTimeout(advance, callDelayMs);
      return () => clearTimeout(t);
    }
    return;
  }, [currentAttempt, advance, callDelayMs]);

  const record = useCallback(
    async (outcome: CallOutcomeKey) => {
      if (!current || recording) return;
      setRecording(outcome);
      try {
        await logCallOutcome(current.id, { outcome });
        setRecording(null);
        advance();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to record outcome');
        setRecording(null);
      }
    },
    [current, recording, advance],
  );

  const hangup = useCallback(async () => {
    if (currentAttemptId) await hangupAttempt(currentAttemptId);
  }, [currentAttemptId]);

  const skip = useCallback(async () => {
    const a = currentAttempt;
    // No live attempt (or already terminal) — just move on.
    if (!currentAttemptId || !a || a.state === 'ended' || a.state === 'failed') {
      advance();
      return;
    }
    try {
      if (!a.callControlId) {
        // Pre-correlation: cancel and advance now (the attempt is terminal).
        await cancelAttempt(currentAttemptId);
        advance();
      } else if (a.state === 'bridged') {
        // Abandoning a connected human: hang up and advance now.
        await hangupAttempt(currentAttemptId);
        advance();
      } else {
        // Live, correlated, pre-bridge: request hangup but DON'T advance here —
        // the terminal-state effect advances once the attempt actually ends, so
        // we never start the next dial while this one is still in progress
        // (which the server's one-live-attempt guard would reject).
        await hangupAttempt(currentAttemptId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to skip');
      advance();
    }
  }, [currentAttemptId, currentAttempt, advance]);

  const togglePause = useCallback(async () => {
    if (!runId) return;
    const next = !paused;
    setPaused(next);
    try {
      await setRunStatus(runId, next ? 'paused' : 'active');
    } catch (e) {
      setPaused(!next); // revert on failure
      setError(e instanceof Error ? e.message : 'Failed to update run status');
    }
  }, [runId, paused]);

  // --- Render ---------------------------------------------------------------

  if (total === 0) {
    return (
      <div style={{ ...card, textAlign: 'center', color: '#666' }}>
        <p style={{ margin: 0 }}>No contacts available for an AMD run.</p>
      </div>
    );
  }

  if (runId === null) {
    return (
      <div style={card}>
        <p style={{ margin: '0 0 1rem', color: '#374151' }}>
          {total} {total === 1 ? 'contact' : 'contacts'} ready. The dialler will detect voicemails
          automatically and connect you only when a human answers.
        </p>
        <button type="button" onClick={start} style={primaryBtn}>
          Start AMD Run
        </button>
        {error ? <p style={{ color: '#b91c1c', fontSize: '0.85rem' }}>{error}</p> : null}
      </div>
    );
  }

  if (done) {
    return (
      <div style={{ ...card, textAlign: 'center', color: '#166534', background: '#f0fdf4', borderColor: '#bbf7d0' }}>
        <p style={{ margin: 0, fontWeight: 600 }}>AMD run complete.</p>
        <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
          {tally.humans} connected · {tally.voicemails} voicemails · {tally.noAnswers} no-answer
        </p>
      </div>
    );
  }

  const showOutcomes = awaitOutcome;

  return (
    <div>
      <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', color: '#6b7280' }}>
        <span>Contact {index + 1} of {total}</span>
        <span>
          {tally.humans} connected · {tally.voicemails} VM · {tally.noAnswers} no-answer
        </span>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem' }}>{current?.name}</h2>
            <p style={{ margin: '0.25rem 0 0', color: '#6b7280', fontSize: '0.9rem' }}>
              {[current?.jobTitle, current?.company].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>
            {liveLabel(currentAttempt)}
          </span>
        </div>
        <p style={{ margin: '0.75rem 0 0', fontSize: '1.05rem', fontWeight: 600 }}>{current?.dialNumber}</p>

        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.6rem' }}>
          {currentAttempt && NON_TERMINAL.has(currentAttempt.state) ? (
            <button type="button" onClick={hangup} style={{ ...primaryBtn, background: '#b91c1c', borderColor: '#b91c1c' }}>
              Hang up
            </button>
          ) : null}
          <button type="button" onClick={skip} style={secondaryBtn} disabled={recording !== null}>
            Skip
          </button>
          <button type="button" onClick={togglePause} style={secondaryBtn}>
            {paused ? 'Resume run' : 'Pause run'}
          </button>
        </div>
      </div>

      {showOutcomes ? (
        <div style={card}>
          <h3 style={{ margin: '0 0 0.9rem', fontSize: '0.95rem', color: '#374151' }}>
            You&apos;re connected — what happened?
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.6rem' }}>
            {outcomes.map((o) => (
              <button
                key={o.key}
                type="button"
                disabled={recording !== null}
                onClick={() => record(o.key)}
                style={{ ...outcomeBtn, cursor: recording !== null ? 'wait' : 'pointer' }}
              >
                {recording === o.key ? 'Saving…' : o.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {error ? <p style={{ marginTop: '1rem', color: '#b91c1c', fontSize: '0.85rem' }}>{error}</p> : null}
    </div>
  );
}
