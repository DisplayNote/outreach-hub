'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDiallerDriver, getDiallerOutcomes } from '@/lib/dialler';
import { pickDialNumber } from '@/lib/dialler/normalise';
import type { CallControl, CallOutcome, CallState, DiallerDriver } from '@/lib/dialler/types';
import { logCallOutcome } from '@/lib/actions/dialler';

/**
 * Click-to-call panel for a single contact.
 *
 * Drives a *simulated* call through the client-side {@link MockDiallerDriver}
 * (no real telephony): pressing "Call" places the call, the panel reflects the
 * live lifecycle (`dialling` → `ringing` → `connected`) with an elapsed timer
 * and a "Hang up" control, and once the call ends it presents the disposition
 * buttons from {@link getDiallerOutcomes}. Selecting one calls the
 * `logCallOutcome` Server Action — which appends a `phone` touchpoint and
 * advances the contact's status when the outcome maps to one — then shows a
 * confirmation.
 *
 * Client component because it owns timers, the driver handle, and interactive
 * state. The only server work is the `logCallOutcome` action; status/touchpoint
 * validation lives in that action's zod schema, not here.
 *
 * Styling mirrors the inline-style approach used across the app (Tailwind is
 * not wired yet — see app/today/page.tsx and app/contacts/[id]/page.tsx).
 */

interface ClickToCallProps {
  /** Contact id — passed to `logCallOutcome`. */
  contactId: string;
  /** Display name, used in the panel header. */
  contactName: string;
  /** Landline; either this or `mobile` must be set for the button to enable. */
  phone: string | null;
  /** Mobile, preferred over `phone` when both are present. */
  mobile: string | null;
  /** Org default calling code (e.g. `+44`), forwarded to number normalisation. */
  defaultCountryCode?: string;
}

const STATE_LABELS: Record<CallState, string> = {
  idle: 'Idle',
  dialling: 'Dialling…',
  ringing: 'Ringing…',
  connected: 'Connected',
  ended: 'Call ended',
  'awaiting-outcome': 'Call ended',
};

/** Dot colour per live state, for a quick visual cue. */
const STATE_COLORS: Record<CallState, string> = {
  idle: '#9ca3af',
  dialling: '#f59e0b',
  ringing: '#f59e0b',
  connected: '#16a34a',
  ended: '#6b7280',
  'awaiting-outcome': '#6b7280',
};

const cardStyle: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  padding: '1.25rem 1.5rem',
  background: 'white',
};

const sectionTitleStyle: React.CSSProperties = {
  margin: '0 0 0.75rem',
  fontSize: '0.8125rem',
  fontWeight: 600,
  color: '#555',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};

const callButtonStyle: React.CSSProperties = {
  padding: '0.55rem 1.1rem',
  fontSize: '0.9375rem',
  fontWeight: 600,
  cursor: 'pointer',
  background: '#16a34a',
  color: 'white',
  border: 0,
  borderRadius: 4,
};

const hangupButtonStyle: React.CSSProperties = {
  padding: '0.55rem 1.1rem',
  fontSize: '0.9375rem',
  fontWeight: 600,
  cursor: 'pointer',
  background: '#dc2626',
  color: 'white',
  border: 0,
  borderRadius: 4,
};

const outcomeButtonStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  fontSize: '0.875rem',
  textAlign: 'left',
  cursor: 'pointer',
  background: '#f9fafb',
  color: '#374151',
  border: '1px solid #d1d5db',
  borderRadius: 4,
};

/** Format elapsed milliseconds as M:SS. */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default function ClickToCall({
  contactId,
  contactName,
  phone,
  mobile,
  defaultCountryCode = '+44',
}: ClickToCallProps) {
  const dialNumber = pickDialNumber({ phone, mobile }, defaultCountryCode);

  // Fresh per instance (getDiallerOutcomes returns a new array by contract).
  const outcomes = useMemo<readonly CallOutcome[]>(() => getDiallerOutcomes(), []);

  const [state, setState] = useState<CallState>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [wasConnected, setWasConnected] = useState(false);
  const [logging, setLogging] = useState<CallOutcome['key'] | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Driver + live call handle live in refs so re-renders don't recreate them.
  const driverRef = useRef<DiallerDriver | null>(null);
  const controlRef = useRef<CallControl | null>(null);
  const connectedAtRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTicking = useCallback(() => {
    if (tickRef.current !== null) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  // Tidy up any live call / interval if the component unmounts mid-call.
  useEffect(() => {
    return () => {
      stopTicking();
      controlRef.current?.hangup();
    };
  }, [stopTicking]);

  const startCall = useCallback(() => {
    if (dialNumber === null) return;
    // Re-entry guard: placeCall sets controlRef synchronously and onEnded/
    // onError/catch clear it, so a non-null handle means a call is already live.
    // Without this, a double-click before the async onStateChange fires would
    // start a second call and orphan the first by overwriting controlRef.
    if (controlRef.current !== null) return;

    setError(null);
    setConfirmation(null);
    setElapsedMs(0);
    setWasConnected(false);
    connectedAtRef.current = null;

    try {
      // getDiallerDriver()/placeCall can throw synchronously (e.g. the Telnyx
      // stub), which the onError callback would never see — catch it here so a
      // misconfigured driver surfaces an error state instead of crashing.
      const driver = driverRef.current ?? getDiallerDriver();
      driverRef.current = driver;

      controlRef.current = driver.placeCall(dialNumber, {
        onStateChange: (call) => {
          setState(call.state);
          if (call.state === 'connected' && connectedAtRef.current === null) {
            connectedAtRef.current = Date.now();
            setWasConnected(true);
            stopTicking();
            tickRef.current = setInterval(() => {
              if (connectedAtRef.current !== null) {
                setElapsedMs(Date.now() - connectedAtRef.current);
              }
            }, 250);
          }
        },
        onEnded: () => {
          stopTicking();
          if (connectedAtRef.current !== null) {
            setElapsedMs(Date.now() - connectedAtRef.current);
          }
          // Move to the disposition step once the call is over.
          setState('awaiting-outcome');
          controlRef.current = null;
        },
        onError: (err) => {
          stopTicking();
          setError(err.message);
          setState('idle');
          controlRef.current = null;
        },
      });
    } catch (err) {
      stopTicking();
      setError(err instanceof Error ? err.message : 'Could not start the call');
      setState('idle');
      controlRef.current = null;
    }
  }, [dialNumber, stopTicking]);

  const hangup = useCallback(() => {
    controlRef.current?.hangup();
  }, []);

  const handleOutcome = useCallback(
    async (outcome: CallOutcome) => {
      setLogging(outcome.key);
      setError(null);
      try {
        const result = await logCallOutcome(contactId, { outcome: outcome.key });
        setConfirmation(
          result.status === null
            ? `Logged: ${outcome.label}.`
            : `Logged: ${outcome.label}. Status set to ${result.status}.`,
        );
        setState('idle');
        setElapsedMs(0);
        setWasConnected(false);
        connectedAtRef.current = null;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to log call outcome.');
      } finally {
        setLogging(null);
      }
    },
    [contactId],
  );

  const isLive = state === 'dialling' || state === 'ringing' || state === 'connected';
  const isAwaitingOutcome = state === 'awaiting-outcome';

  return (
    <section style={cardStyle}>
      <h2 style={sectionTitleStyle}>Call</h2>

      {dialNumber === null ? (
        <p style={{ margin: 0, color: '#888', fontSize: '0.9375rem' }}>
          No phone or mobile number on file for {contactName}.
        </p>
      ) : (
        <>
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.9375rem', color: '#374151' }}>
            <span style={{ color: '#888' }}>Dialling </span>
            <a href={`tel:${dialNumber}`} style={{ color: '#2563eb', textDecoration: 'none' }}>
              {dialNumber}
            </a>
          </p>

          {/* Idle: offer the Call button (plus any prior confirmation). */}
          {state === 'idle' ? (
            <>
              <button type="button" onClick={startCall} style={callButtonStyle}>
                Call {contactName}
              </button>
              {confirmation ? (
                <p
                  role="status"
                  style={{ margin: '0.75rem 0 0', color: '#16a34a', fontSize: '0.875rem' }}
                >
                  {confirmation}
                </p>
              ) : null}
            </>
          ) : null}

          {/* Live: status dot + label, elapsed timer once connected, Hang up. */}
          {isLive ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span
                  aria-hidden="true"
                  style={{
                    display: 'inline-block',
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: STATE_COLORS[state],
                  }}
                />
                <span style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#374151' }}>
                  {STATE_LABELS[state]}
                </span>
                {state === 'connected' ? (
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontVariantNumeric: 'tabular-nums',
                      fontSize: '0.9375rem',
                      color: '#374151',
                    }}
                  >
                    {formatElapsed(elapsedMs)}
                  </span>
                ) : null}
              </div>
              <button type="button" onClick={hangup} style={hangupButtonStyle}>
                Hang up
              </button>
            </div>
          ) : null}

          {/* Ended: present the disposition buttons. */}
          {isAwaitingOutcome ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <p style={{ margin: 0, fontSize: '0.9375rem', color: '#374151' }}>
                Call ended{wasConnected ? ` after ${formatElapsed(elapsedMs)}` : ''}.
                How did it go?
              </p>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  gap: '0.5rem',
                }}
              >
                {outcomes.map((outcome) => (
                  <button
                    key={outcome.key}
                    type="button"
                    onClick={() => void handleOutcome(outcome)}
                    disabled={logging !== null}
                    style={
                      logging !== null
                        ? { ...outcomeButtonStyle, opacity: 0.5, cursor: 'not-allowed' }
                        : outcomeButtonStyle
                    }
                  >
                    {logging === outcome.key ? 'Saving…' : outcome.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {error ? (
            <p role="alert" style={{ margin: '0.75rem 0 0', color: '#dc2626', fontSize: '0.875rem' }}>
              {error}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
