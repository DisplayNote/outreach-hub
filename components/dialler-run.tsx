'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { logCallOutcome, type CallOutcomeKey } from '@/lib/actions/dialler';
import { getDiallerDriver, getDiallerOutcomes } from '@/lib/dialler';
import type { CallControl, CallState } from '@/lib/dialler/types';
import type { ContactStatus } from '@/lib/types/domain';
import { Avatar, Button, Card, EmptyState, Icon, Pill } from '@/components/ui';
import { STATUS_PILLS } from '@/lib/ui/status';

/**
 * Client-side dialler run controller.
 *
 * Walks a pre-built call queue one contact at a time. For the current contact
 * it drives the mock {@link DiallerDriver} through the call lifecycle
 * (`idle` → `dialling` → `ringing` → `connected` → `ended`), then surfaces the
 * outcome buttons. Recording an outcome calls the `logCallOutcome` Server Action
 * (which appends a `phone` touchpoint and advances the contact's status), then
 * auto-advances to the next contact. Skip/next move through the queue without
 * writing.
 *
 * `'use client'` because the call lifecycle is timer-driven and every control is
 * interactive. The queue itself is fetched server-side and passed in as a plain
 * serialisable array.
 *
 * Styling mirrors the inline-style approach used in app/today/page.tsx and
 * components/contact-form.tsx (Tailwind is not wired yet).
 */

/** A queue entry: the minimum a caller needs to dial and label one contact. */
export interface DiallerQueueItem {
  id: string;
  name: string;
  company: string | null;
  jobTitle: string | null;
  status: ContactStatus;
  /** Normalised E.164 number to dial (queue only ever contains dialable contacts). */
  dialNumber: string;
}

export interface DiallerRunProps {
  queue: readonly DiallerQueueItem[];
}

// --- Display helpers ---------------------------------------------------------

/** Up-to-two-letter initials from a queue item's display name. */
function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
  }
  const single = parts[0] ?? '';
  return (single.slice(0, 2) || '?').toUpperCase();
}

const CALL_STATE_LABELS: Record<CallState, string> = {
  idle: 'Ready to call',
  dialling: 'Dialling…',
  ringing: 'Ringing…',
  connected: 'Connected',
  ended: 'Call ended',
  'awaiting-outcome': 'Record the outcome',
};

/** Whether the call is in a live, hang-up-able state. */
function isLive(state: CallState): boolean {
  return state === 'dialling' || state === 'ringing' || state === 'connected';
}

/** Tone for the live-state badge dot/text. */
const STATE_TONE: Record<CallState, { color: string; bg: string; pulse: boolean }> = {
  idle: { color: 'var(--text-tertiary)', bg: 'var(--neutral-100)', pulse: false },
  dialling: { color: 'var(--blue-700)', bg: 'var(--blue-50)', pulse: true },
  ringing: { color: 'var(--blue-700)', bg: 'var(--blue-50)', pulse: true },
  connected: { color: 'var(--green-700)', bg: 'var(--green-50)', pulse: false },
  ended: { color: 'var(--text-tertiary)', bg: 'var(--neutral-100)', pulse: false },
  'awaiting-outcome': { color: 'var(--violet-700)', bg: 'var(--violet-50)', pulse: false },
};

export default function DiallerRun({ queue }: DiallerRunProps) {
  const outcomes = useMemo(() => getDiallerOutcomes(), []);

  const [index, setIndex] = useState(0);
  const [callState, setCallState] = useState<CallState>('idle');
  const [callError, setCallError] = useState<string | null>(null);
  const [recording, setRecording] = useState<CallOutcomeKey | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);

  const controlRef = useRef<CallControl | null>(null);

  const total = queue.length;
  const current = index < total ? queue[index] : undefined;
  const done = index >= total;

  // Tear down any live call when the contact changes or the component unmounts.
  const resetForNext = useCallback(() => {
    controlRef.current?.hangup();
    controlRef.current = null;
    setCallState('idle');
    setCallError(null);
    setRecording(null);
    setRecordError(null);
  }, []);

  useEffect(() => {
    // Cleanup on unmount: stop any in-flight mock call timers.
    return () => {
      controlRef.current?.hangup();
      controlRef.current = null;
    };
  }, []);

  const advance = useCallback(() => {
    resetForNext();
    setIndex((i) => i + 1);
  }, [resetForNext]);

  const startCall = useCallback(() => {
    if (!current) return;
    setCallError(null);
    try {
      // getDiallerDriver()/placeCall can throw synchronously (e.g. the Telnyx
      // stub), which the onError callback would never see — catch it here so a
      // misconfigured driver surfaces an error state instead of crashing.
      const driver = getDiallerDriver();
      const control = driver.placeCall(current.dialNumber, {
        onStateChange: (call) => setCallState(call.state),
        onEnded: () => setCallState('awaiting-outcome'),
        onError: (err) => {
          setCallError(err.message);
          setCallState('idle');
        },
      });
      controlRef.current = control;
    } catch (err) {
      setCallError(err instanceof Error ? err.message : 'Could not start the call');
      setCallState('idle');
    }
  }, [current]);

  const hangup = useCallback(() => {
    controlRef.current?.hangup();
  }, []);

  const record = useCallback(
    async (outcome: CallOutcomeKey) => {
      if (!current || recording) return;
      setRecording(outcome);
      setRecordError(null);
      try {
        await logCallOutcome(current.id, { outcome });
        advance();
      } catch (err) {
        setRecordError(err instanceof Error ? err.message : 'Failed to record outcome');
        setRecording(null);
      }
    },
    [current, recording, advance],
  );

  // --- Empty / completed states ---------------------------------------------

  if (total === 0) {
    return (
      <Card bodyStyle={{ padding: 0 }}>
        <EmptyState
          icon="dialler"
          title="No calls in the queue"
          desc="Nobody is due for a call right now, or no due contact has a phone number."
        />
      </Card>
    );
  }

  if (done || !current) {
    return (
      <Card bodyStyle={{ padding: 0 }}>
        <EmptyState
          icon="checkCircle"
          title="Queue complete"
          desc={`You worked through all ${total} ${total === 1 ? 'call' : 'calls'}.`}
        />
      </Card>
    );
  }

  // --- Active run ------------------------------------------------------------

  const showOutcomes = callState === 'awaiting-outcome';
  const tone = STATE_TONE[callState];

  return (
    <div className="col gap-6">
      {/* Progress */}
      <div className="row gap-5 center">
        <span className="sm muted" style={{ whiteSpace: 'nowrap' }}>
          Call {index + 1} of {total}
        </span>
        <span aria-hidden className="grow">
          <span
            style={{
              display: 'block',
              height: 6,
              borderRadius: 'var(--radius-full)',
              background: 'var(--neutral-150)',
              overflow: 'hidden',
            }}
          >
            <span
              style={{
                display: 'block',
                height: '100%',
                width: `${(index / total) * 100}%`,
                background: 'var(--accent)',
                transition: 'width var(--dur-base)',
              }}
            />
          </span>
        </span>
      </div>

      {/* Current contact */}
      <Card>
        <div className="row gap-5 center between">
          <div className="row gap-5 center" style={{ minWidth: 0 }}>
            <Avatar initials={initialsFor(current.name)} size="lg" />
            <div style={{ minWidth: 0 }}>
              <div className="semib" style={{ fontSize: 'var(--fs-h3)' }}>
                {current.name}
              </div>
              <div className="sm muted">
                {[current.jobTitle, current.company].filter(Boolean).join(' · ') || '—'}
              </div>
            </div>
          </div>
          <Pill spec={STATUS_PILLS[current.status]} />
        </div>

        <div
          className="row gap-5 center between"
          style={{
            marginTop: 'var(--space-6)',
            paddingTop: 'var(--space-6)',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <div>
            <a
              href={`tel:${current.dialNumber}`}
              className="mono semib"
              style={{ fontSize: 'var(--fs-h3)', color: 'var(--text-primary)', textDecoration: 'none' }}
            >
              {current.dialNumber}
            </a>
            <div className="row gap-3 center" style={{ marginTop: 'var(--space-3)' }}>
              <span
                className="pill"
                style={{
                  color: tone.color,
                  background: tone.bg,
                  height: 24,
                  fontSize: 'var(--fs-caption)',
                }}
              >
                <span
                  className="pill__dot"
                  style={{
                    background: tone.color,
                    ...(tone.pulse ? { animation: 'oh-fade-in 0.8s infinite alternate' } : {}),
                  }}
                />
                {CALL_STATE_LABELS[callState]}
              </span>
            </div>
          </div>

          {callState === 'idle' ? (
            <Button variant="primary" icon="phone" onClick={startCall}>
              Call
            </Button>
          ) : isLive(callState) ? (
            <Button variant="danger" icon="x" onClick={hangup}>
              Hang up
            </Button>
          ) : null}
        </div>

        {callError ? (
          <div className="banner banner--danger" style={{ marginTop: 'var(--space-5)' }}>
            <span className="banner__icon">
              <Icon name="alertCircle" size={16} />
            </span>
            <span>{callError}</span>
          </div>
        ) : null}
      </Card>

      {/* Outcome buttons */}
      {showOutcomes ? (
        <Card title="What happened?">
          <div className="outcome-grid">
            {outcomes.map((outcome) => (
              <button
                key={outcome.key}
                type="button"
                className="outcome-btn"
                disabled={recording !== null}
                onClick={() => record(outcome.key)}
                style={{
                  opacity: recording !== null && recording !== outcome.key ? 0.5 : 1,
                  cursor: recording !== null ? 'wait' : 'pointer',
                }}
              >
                <span className="outcome-btn__label">
                  {recording === outcome.key ? 'Saving…' : outcome.label}
                </span>
              </button>
            ))}
          </div>

          {recordError ? (
            <div className="banner banner--danger" style={{ marginTop: 'var(--space-5)' }}>
              <span className="banner__icon">
                <Icon name="alertCircle" size={16} />
              </span>
              <span>{recordError}</span>
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* Skip / next */}
      <div className="row gap-5">
        <Button variant="secondary" onClick={advance} disabled={recording !== null}>
          {showOutcomes ? 'Skip without logging' : 'Skip contact'}
        </Button>
      </div>
    </div>
  );
}
