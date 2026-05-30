import type { DiallerDriver } from '@/lib/dialler/driver';
import { MockDiallerDriver } from '@/lib/dialler/mock';
import { TelnyxDiallerDriver } from '@/lib/dialler/telnyx';

export type DiallerDriverName = 'mock' | 'telnyx';

/**
 * Select the dialler backend (defaults to `mock`). The driver runs in the
 * browser, so the public `NEXT_PUBLIC_DIALLER_DRIVER` is read first — only
 * `NEXT_PUBLIC_*` vars are inlined into the client bundle; a bare
 * `DIALLER_DRIVER` would be `undefined` client-side and silently fall back to
 * mock. `DIALLER_DRIVER` is still honoured for any server-side use.
 * `telnyx` is a stub until Phase 4 — its methods throw `NotImplementedError`.
 */
export function getDiallerDriver(): DiallerDriver {
  const configured =
    process.env.NEXT_PUBLIC_DIALLER_DRIVER ?? process.env.DIALLER_DRIVER;
  const driver = (configured ?? 'mock') as DiallerDriverName;

  switch (driver) {
    case 'mock':
      return new MockDiallerDriver();
    case 'telnyx':
      return new TelnyxDiallerDriver();
    default:
      throw new Error(`Unknown DIALLER_DRIVER: ${driver as string}`);
  }
}

// The canonical outcome catalogue lives in ./outcomes (driver-free, so it can be
// shared with the logCallOutcome Server Action). Re-exported here for the UI.
export {
  getDiallerOutcomes,
  getOutcomeDef,
  resolveStatusEffect,
  outcomeSchedulesCallback,
  CALL_OUTCOME_KEYS,
} from '@/lib/dialler/outcomes';

export type { DiallerDriver };
export { MockDiallerDriver, TelnyxDiallerDriver };
