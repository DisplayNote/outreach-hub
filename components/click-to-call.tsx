'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDiallerDriver, getDiallerOutcomes } from '@/lib/dialler';
import { pickDialNumber } from '@/lib/dialler/normalise';
import type { CallControl, CallOutcome, CallState, DiallerDriver } from '@/lib/dialler/types';
import { logCallOutcome } from '@/lib/actions/dialler';
import { Button, Card, Icon } from '@/components/ui';

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
 * Styling uses the shared design-system primitives (`@/components/ui`) and the
 * vendored stylesheet utility classes.
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
  idle: 'var(--text-tertiary)',
  dialling: 'var(--amber-500)',
  ringing: 'var(--amber-500)',
  connected: 'var(--green-600)',
  ended: 'var(--text-tertiary)',
  'awaiting-outcome': 'var(--text-tertiary)',
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
      // Clear the handle BEFORE hangup: the mock driver's hangup() fires
      // onStateChange/onEnded synchronously, and the callback guards below treat
      // a null controlRef as "teardown in progress" and no-op — avoiding a
      // setState on an unmounted component.
      const control = controlRef.current;
      controlRef.current = null;
      control?.hangup();
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
          // No-op once teardown has cleared the handle (see the unmount cleanup).
          if (controlRef.current === null) return;
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
          // No-op once teardown has cleared the handle (see the unmount cleanup).
          if (controlRef.current === null) return;
          stopTicking();
          if (connectedAtRef.current !== null) {
            setElapsedMs(Date.now() - connectedAtRef.current);
          }
          // Move to the disposition step once the call is over.
          setState('awaiting-outcome');
          controlRef.current = null;
        },
        onError: (err) => {
          // No-op once teardown has cleared the handle (see the unmount cleanup).
          if (controlRef.current === null) return;
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
    <Card title="Call">
      {dialNumber === null ? (
        <p className="sm muted" style={{ margin: 0 }}>
          No phone or mobile number on file for {contactName}.
        </p>
      ) : (
        <div className="col gap-5">
          <p className="sm" style={{ margin: 0 }}>
            <span className="tert">Dialling </span>
            <a
              href={`tel:${dialNumber}`}
              className="mono"
              style={{ color: 'var(--accent-text)', textDecoration: 'none' }}
            >
              {dialNumber}
            </a>
          </p>

          {/* Idle: offer the Call button (plus any prior confirmation). */}
          {state === 'idle' ? (
            <>
              <div>
                <Button variant="primary" icon="phone" onClick={startCall}>
                  Call {contactName}
                </Button>
              </div>
              {confirmation ? (
                <div className="banner banner--success" role="status">
                  <span className="banner__icon">
                    <Icon name="checkCircle" size={16} />
                  </span>
                  <span>{confirmation}</span>
                </div>
              ) : null}
            </>
          ) : null}

          {/* Live: status dot + label, elapsed timer once connected, Hang up. */}
          {isLive ? (
            <div className="col gap-5">
              <div className="row gap-4 center">
                <span
                  aria-hidden="true"
                  className="pill__dot"
                  style={{ width: 10, height: 10, background: STATE_COLORS[state] }}
                />
                <span className="semib sm">{STATE_LABELS[state]}</span>
                {state === 'connected' ? (
                  <span className="mono tnum sm" style={{ marginLeft: 'auto' }}>
                    {formatElapsed(elapsedMs)}
                  </span>
                ) : null}
              </div>
              <div>
                <Button variant="danger" icon="x" onClick={hangup}>
                  Hang up
                </Button>
              </div>
            </div>
          ) : null}

          {/* Ended: present the disposition buttons. */}
          {isAwaitingOutcome ? (
            <div className="col gap-5">
              <p className="sm" style={{ margin: 0 }}>
                Call ended{wasConnected ? ` after ${formatElapsed(elapsedMs)}` : ''}. How did it
                go?
              </p>
              <div className="outcome-grid">
                {outcomes.map((outcome) => (
                  <button
                    key={outcome.key}
                    type="button"
                    className="outcome-btn"
                    onClick={() => void handleOutcome(outcome)}
                    disabled={logging !== null}
                    style={logging !== null ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                  >
                    <span className="outcome-btn__label">
                      {logging === outcome.key ? 'Saving…' : outcome.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="banner banner--danger" role="alert">
              <span className="banner__icon">
                <Icon name="alertCircle" size={16} />
              </span>
              <span>{error}</span>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}
