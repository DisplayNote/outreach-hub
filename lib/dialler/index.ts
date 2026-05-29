import type { DiallerDriver } from '@/lib/dialler/driver';
import { MockDiallerDriver } from '@/lib/dialler/mock';
import { TelnyxDiallerDriver } from '@/lib/dialler/telnyx';
import type { CallOutcome } from '@/lib/dialler/types';

export type DiallerDriverName = 'mock' | 'telnyx';

/**
 * Select the dialler backend from `DIALLER_DRIVER` (defaults to `mock`).
 * `telnyx` is a stub until Phase 4 — its methods throw `NotImplementedError`.
 */
export function getDiallerDriver(): DiallerDriver {
  const driver = process.env.DIALLER_DRIVER as DiallerDriverName | undefined;

  switch (driver) {
    case 'mock':
    case undefined:
      return new MockDiallerDriver();
    case 'telnyx':
      return new TelnyxDiallerDriver();
    default:
      throw new Error(`Unknown DIALLER_DRIVER: ${driver as string}`);
  }
}

/**
 * The canonical call-outcome model the UI renders after a call ends. Each entry
 * pairs a {@link CallOutcome.key} with its display label, the contact
 * `statusEffect` to apply, and a `defaultNote` to seed the `phone` touchpoint.
 * Returned as a fresh array so callers can sort/filter without mutating shared
 * state.
 */
export function getDiallerOutcomes(): CallOutcome[] {
  return [
    {
      key: 'connected',
      label: 'Connected — had conversation',
      statusEffect: 'green',
      defaultNote: 'Call connected',
    },
    {
      key: 'callback-requested',
      label: 'Callback requested',
      statusEffect: 'green',
      defaultNote: 'Callback requested',
    },
    {
      key: 'meeting-booked',
      label: 'Meeting booked',
      statusEffect: 'meeting',
      defaultNote: 'Meeting booked',
    },
    {
      key: 'left-voicemail',
      label: 'Left voicemail',
      statusEffect: 'none',
      defaultNote: 'Voicemail reached',
    },
    {
      key: 'no-answer',
      label: 'No answer',
      statusEffect: 'none',
      defaultNote: 'No answer',
    },
    {
      key: 'gatekeeper',
      label: 'Gatekeeper / wrong person',
      statusEffect: 'none',
      defaultNote: 'Reached gatekeeper',
    },
    {
      key: 'not-interested',
      label: 'Not interested',
      statusEffect: 'notinterested',
      defaultNote: 'Not interested',
    },
    {
      key: 'wrong-number',
      label: 'Wrong number',
      statusEffect: 'bounced',
      defaultNote: 'Wrong number',
    },
  ];
}

export type { DiallerDriver };
export { MockDiallerDriver, TelnyxDiallerDriver };
