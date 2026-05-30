'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { logCallOutcome, type CallOutcomeKey } from '@/lib/actions/dialler';
import { getDiallerDriver, getDiallerOutcomes } from '@/lib/dialler';
import type { CallControl, CallState } from '@/lib/dialler/types';
import type { ContactStatus } from '@/lib/types/domain';

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

const STATUS_LABELS: Record<ContactStatus, string> = {
  none: 'No status',
  amber: 'Amber',
  red: 'Red',
  green: 'Green',
  meeting: 'Meeting',
  notinterested: 'Not interested',
  bounced: 'Bounced',
};

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

// --- Styles ------------------------------------------------------------------

const cardStyle: React.CSSProperties = {
  marginTop: '1.5rem',
  padding: '1.5rem',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  background: '#fff',
};

const primaryButtonStyle: React.CSSProperties = {
  padding: '0.6rem 1.4rem',
  background: '#111',
  color: '#fff',
  border: '1px solid #111',
  borderRadius: 6,
  fontSize: '0.95rem',
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: '0.6rem 1.2rem',
  background: '#fff',
  color: '#374151',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: '0.9375rem',
  cursor: 'pointer',
};

const dangerButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  background: '#b91c1c',
  borderColor: '#b91c1c',
};

const outcomeButtonStyle: React.CSSProperties = {
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
      <div
        style={{
          marginTop: '2rem',
          padding: '2rem',
          textAlign: 'center',
          color: '#666',
          background: '#fafafa',
          border: '1px solid #eee',
          borderRadius: 6,
        }}
      >
        <p style={{ margin: 0, fontSize: '1.05rem' }}>No calls in the queue.</p>
        <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
          Nobody is due for a call right now, or no due contact has a phone number.
        </p>
      </div>
    );
  }

  if (done || !current) {
    return (
      <div
        style={{
          marginTop: '2rem',
          padding: '2rem',
          textAlign: 'center',
          color: '#166534',
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          borderRadius: 6,
        }}
      >
        <p style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600 }}>
          Queue complete.
        </p>
        <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem', color: '#15803d' }}>
          You worked through all {total} {total === 1 ? 'call' : 'calls'}.
        </p>
      </div>
    );
  }

  // --- Active run ------------------------------------------------------------

  const showOutcomes = callState === 'awaiting-outcome';

  return (
    <div>
      {/* Progress */}
      <div
        style={{
          marginTop: '1.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '0.875rem',
          color: '#6b7280',
        }}
      >
        <span>
          Call {index + 1} of {total}
        </span>
        <span aria-hidden style={{ flex: 1, margin: '0 1rem' }}>
          <span
            style={{
              display: 'block',
              height: 6,
              borderRadius: 3,
              background: '#e5e7eb',
              overflow: 'hidden',
            }}
          >
            <span
              style={{
                display: 'block',
                height: '100%',
                width: `${(index / total) * 100}%`,
                background: '#111',
                transition: 'width 0.2s',
              }}
            />
          </span>
        </span>
      </div>

      {/* Current contact */}
      <div style={cardStyle}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: '1rem',
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem' }}>{current.name}</h2>
            <p style={{ margin: '0.25rem 0 0', color: '#6b7280', fontSize: '0.9rem' }}>
              {[current.jobTitle, current.company].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
          <span
            style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
              color: '#6b7280',
              whiteSpace: 'nowrap',
            }}
          >
            {STATUS_LABELS[current.status]}
          </span>
        </div>

        <div
          style={{
            marginTop: '1rem',
            paddingTop: '1rem',
            borderTop: '1px solid #f3f4f6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
          }}
        >
          <div>
            <a
              href={`tel:${current.dialNumber}`}
              style={{ fontSize: '1.1rem', fontWeight: 600, color: '#111', textDecoration: 'none' }}
            >
              {current.dialNumber}
            </a>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: '#9ca3af' }}>
              {CALL_STATE_LABELS[callState]}
            </p>
          </div>

          {callState === 'idle' ? (
            <button type="button" onClick={startCall} style={primaryButtonStyle}>
              Call
            </button>
          ) : isLive(callState) ? (
            <button type="button" onClick={hangup} style={dangerButtonStyle}>
              Hang up
            </button>
          ) : null}
        </div>

        {callError ? (
          <p style={{ margin: '0.75rem 0 0', color: '#b91c1c', fontSize: '0.85rem' }}>
            {callError}
          </p>
        ) : null}
      </div>

      {/* Outcome buttons */}
      {showOutcomes ? (
        <div style={cardStyle}>
          <h3 style={{ margin: '0 0 0.9rem', fontSize: '0.95rem', color: '#374151' }}>
            What happened?
          </h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '0.6rem',
            }}
          >
            {outcomes.map((outcome) => (
              <button
                key={outcome.key}
                type="button"
                disabled={recording !== null}
                onClick={() => record(outcome.key)}
                style={{
                  ...outcomeButtonStyle,
                  opacity: recording !== null && recording !== outcome.key ? 0.5 : 1,
                  cursor: recording !== null ? 'wait' : 'pointer',
                }}
              >
                {recording === outcome.key ? 'Saving…' : outcome.label}
              </button>
            ))}
          </div>

          {recordError ? (
            <p style={{ margin: '0.75rem 0 0', color: '#b91c1c', fontSize: '0.85rem' }}>
              {recordError}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Skip / next */}
      <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem' }}>
        <button
          type="button"
          onClick={advance}
          disabled={recording !== null}
          style={secondaryButtonStyle}
        >
          {showOutcomes ? 'Skip without logging' : 'Skip contact'}
        </button>
      </div>
    </div>
  );
}
