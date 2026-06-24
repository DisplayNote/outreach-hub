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
import { logCallOutcome } from '@/lib/actions/dialler';
import type { CallOutcomeKey } from '@/lib/dialler/types';
import { getDiallerOutcomes } from '@/lib/dialler';
import { startAmdRun, placeAmdCall, hangupAttempt, cancelAttempt, setRunStatus } from '@/lib/actions/dialler-amd';
import { useAmdRun } from '@/lib/dialler/amd/use-amd-run';
import type { CallAttempt, CallAttemptState } from '@/lib/dialler/amd/types';
import { Button, Card, EmptyState } from '@/components/ui';
import type { DiallerQueueItem } from '@/components/dialler-run';

export interface AmdRunProps {
  queue: readonly DiallerQueueItem[];
  /** Pause between attempts (ms), from org settings; defaults to 3s. */
  callDelayMs?: number;
}

/** A call is "live" (hang-up-able) in any non-terminal state, including a
 * connected human (`bridged`) and the brief `machine` window before auto-hangup. */
function isLive(state: CallAttemptState): boolean {
  return state !== 'ended' && state !== 'failed';
}

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

export default function AmdRun({ queue, callDelayMs = 3000 }: AmdRunProps) {
  const outcomes = useMemo(() => getDiallerOutcomes(), []);
  const total = queue.length;

  const [runId, setRunId] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [currentAttemptId, setCurrentAttemptId] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [recording, setRecording] = useState<CallOutcomeKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set when the rep skips a *live* call: we request a hangup and let the
  // terminal-state effect advance once the call actually ends, rather than
  // advancing while it's still live (which would race the next dial against the
  // server's one-live-attempt guard).
  const [skipping, setSkipping] = useState(false);

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
    setSkipping(false);
    setIndex((i) => i + 1);
  }, []);

  // Drive the current contact when idle: reconcile to an existing attempt if one
  // already exists for this contact in the run, otherwise place a new call.
  //
  // Reconciliation (re-checked on every `attempts` change, NOT gated by the
  // place guard) handles a place that completed after a pause/unmount: the
  // attempt exists server-side but the UI never attached. It also covers
  // resume-after-completion (the contact's attempt finished during the gap). All
  // setState happens inside the async IIFE, never synchronously in the effect
  // body, to respect the repo's no-synchronous-setState-in-effect rule.
  useEffect(() => {
    if (runId === null || paused || done || awaitOutcome) return;
    if (currentAttemptId !== null || !current) return;

    // Within a run each contact is dialled once, so at most one attempt matches.
    const existing = Object.values(attempts).find((a) => a.contactId === current.id);

    let cancelled = false;
    void (async () => {
      try {
        if (existing) {
          if (cancelled) return;
          if (existing.state !== 'ended' && existing.state !== 'failed') {
            setCurrentAttemptId(existing.id); // attach to the live attempt; don't re-dial
          } else {
            advance(); // already handled during the gap
          }
          return;
        }

        // No attempt for this contact yet → place exactly once.
        if (placedForIndex.current === index) return;
        placedForIndex.current = index;
        const { attemptId } = await placeAmdCall({ runId, contactId: current.id });
        if (!cancelled) setCurrentAttemptId(attemptId);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : 'Dial failed';
        setError(msg);
        if (/already in progress/i.test(msg)) {
          // A live attempt exists (e.g. an orphaned place) — DON'T skip this
          // contact. Reset the guard so the next `attempts` update reconciles
          // and attaches once Realtime delivers the attempt.
          placedForIndex.current = -1;
        } else {
          // Genuine per-contact failure (no number / fail scenario) — move on.
          advance();
        }
      } finally {
        // Torn down (pause / unmount / runId change) before the place settled →
        // clear the guard so resuming re-evaluates instead of stalling.
        if (cancelled) placedForIndex.current = -1;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId, paused, done, awaitOutcome, currentAttemptId, current, index, advance, attempts]);

  // Auto-advance terminal, non-human attempts after the inter-call delay. A
  // bridged (human) call waits for the rep to record an outcome instead.
  useEffect(() => {
    if (!currentAttempt) return;
    const terminal = currentAttempt.state === 'ended' || currentAttempt.state === 'failed';
    // Auto-advance terminal attempts, except a connected human (bridged-human)
    // which waits for the rep to log an outcome — UNLESS the rep skipped it, in
    // which case we advance once the hung-up call has actually ended.
    if (terminal && (currentAttempt.disposition !== 'bridged-human' || skipping)) {
      const t = setTimeout(advance, callDelayMs);
      return () => clearTimeout(t);
    }
    return;
  }, [currentAttempt, advance, callDelayMs, skipping]);

  const record = useCallback(
    async (outcome: CallOutcomeKey) => {
      if (!current || recording || skipping) return;
      setRecording(outcome);
      try {
        await logCallOutcome(current.id, { outcome });
        setRecording(null);
        // Don't advance now: the bridged call may still be live. Latch `skipping`
        // so the terminal-state effect advances this bridged-human attempt once
        // it actually ends — avoids racing the next dial against the server's
        // one-live-attempt guard (and the placing-effect's skip-on-error path).
        setSkipping(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to record outcome');
        setRecording(null);
      }
    },
    [current, recording, skipping],
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
      } else {
        // Live, correlated (incl. a connected human): request hangup and mark
        // skipping, but DON'T advance here — the terminal-state effect advances
        // once the call actually ends, so we never start the next dial while
        // this one is still live (which the one-live-attempt guard would reject,
        // and whose error path could then skip a contact).
        setSkipping(true);
        await hangupAttempt(currentAttemptId);
      }
    } catch (e) {
      // Don't advance on failure: the attempt may still be live, and advancing
      // would strand it (and make the next dial hit the one-live guard). Keep the
      // current contact, clear skipping, and surface the error so the rep retries.
      setError(e instanceof Error ? e.message : 'Failed to skip');
      setSkipping(false);
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
      <Card>
        <EmptyState
          icon="voicemail"
          title="No contacts available for an AMD run."
          desc="Contacts due today with a dialable number appear here, ready for a server-orchestrated run."
        />
      </Card>
    );
  }

  if (runId === null) {
    return (
      <Card>
        <p className="muted" style={{ margin: '0 0 var(--space-6)' }}>
          {total} {total === 1 ? 'contact' : 'contacts'} ready. The dialler will detect voicemails
          automatically and connect you only when a human answers.
        </p>
        <Button type="button" variant="primary" icon="voicemail" onClick={start}>
          Start AMD Run
        </Button>
        {error ? (
          <p className="sm" style={{ color: 'var(--red-700)', marginTop: 'var(--space-5)' }}>
            {error}
          </p>
        ) : null}
      </Card>
    );
  }

  if (done) {
    return (
      <Card>
        <div style={{ textAlign: 'center' }}>
          <p className="semib" style={{ margin: 0, color: 'var(--green-700)' }}>
            AMD run complete.
          </p>
          <p className="sm muted" style={{ margin: 'var(--space-5) 0 0' }}>
            {tally.humans} connected · {tally.voicemails} voicemails · {tally.noAnswers} no-answer
          </p>
        </div>
      </Card>
    );
  }

  const showOutcomes = awaitOutcome;

  return (
    <div className="col gap-6">
      <div
        className="row sm muted"
        style={{ justifyContent: 'space-between' }}
      >
        <span>
          Contact {index + 1} of {total}
        </span>
        <span>
          {tally.humans} connected · {tally.voicemails} VM · {tally.noAnswers} no-answer
        </span>
      </div>

      <Card>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-6)' }}>
          <div>
            <h2 className="semib" style={{ margin: 0, fontSize: 'var(--fs-h3)' }}>
              {current?.name}
            </h2>
            <p className="sm muted" style={{ margin: 'var(--space-3) 0 0' }}>
              {[current?.jobTitle, current?.company].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
          <span className="sm semib" style={{ whiteSpace: 'nowrap' }}>
            {liveLabel(currentAttempt)}
          </span>
        </div>
        <p className="mono semib" style={{ margin: 'var(--space-5) 0 0', fontSize: 'var(--fs-body)' }}>
          {current?.dialNumber}
        </p>

        <div className="row gap-5" style={{ marginTop: 'var(--space-6)' }}>
          {/* Only when a provider call exists to hang up. Pre-correlation
              (callControlId null) there's nothing to hang up — Skip cancels it. */}
          {currentAttempt && isLive(currentAttempt.state) && currentAttempt.callControlId ? (
            <Button type="button" variant="danger" onClick={hangup}>
              Hang up
            </Button>
          ) : null}
          <Button type="button" variant="secondary" onClick={skip} disabled={recording !== null || skipping}>
            Skip
          </Button>
          <Button type="button" variant="secondary" onClick={togglePause}>
            {paused ? 'Resume run' : 'Pause run'}
          </Button>
        </div>
      </Card>

      {showOutcomes ? (
        <Card title="You’re connected — what happened?">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--space-5)' }}>
            {outcomes.map((o) => (
              <Button
                key={o.key}
                type="button"
                variant="secondary"
                disabled={recording !== null || skipping}
                onClick={() => record(o.key)}
                style={{ justifyContent: 'flex-start' }}
              >
                {recording === o.key ? 'Saving…' : o.label}
              </Button>
            ))}
          </div>
        </Card>
      ) : null}

      {error ? (
        <p className="sm" style={{ color: 'var(--red-700)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
