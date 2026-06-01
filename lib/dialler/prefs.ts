import type { UserSettings } from '@/lib/types/domain';

/**
 * Resolved, fully-defaulted dialler UX preferences consumed by the client-side
 * {@link DiallerRun} controller. Unlike the loose, all-optional `UserSettings`
 * keys these are derived from, every field here is present so the component
 * never has to re-derive defaults at the call site.
 */
export interface DiallerPrefs {
  /** Auto-dial the next due contact after an outcome is recorded. */
  autoDial: boolean;
  /** Seconds to pause between an outcome and the next auto-dial. */
  interCallDelaySec: number;
  /** Use browser-synthesised dial/ring tones instead of network ringback. */
  synthTones: boolean;
}

/**
 * Safe inter-call delay used when the user hasn't set one (or set an invalid
 * value). Matches the legacy PWA's `txCallDelay` default.
 */
export const DEFAULT_INTER_CALL_DELAY_SEC = 3;

/**
 * Normalise the three loose `UserSettings` dialler keys into a fully-defaulted
 * {@link DiallerPrefs}. The contract is "default to the current manual
 * behaviour when unset": no auto-dial, network ringback (no synth tones), and a
 * safe inter-call delay.
 *
 * An explicit `0` delay is honoured (immediate auto-dial) — only an absent,
 * negative, NaN, or infinite value falls back to {@link DEFAULT_INTER_CALL_DELAY_SEC}.
 */
export function resolveDiallerPrefs(
  settings: Pick<
    UserSettings,
    'diallerAutoDial' | 'diallerInterCallDelaySec' | 'diallerSynthTones'
  >,
): DiallerPrefs {
  const rawDelay = settings.diallerInterCallDelaySec;
  const interCallDelaySec =
    typeof rawDelay === 'number' && Number.isFinite(rawDelay) && rawDelay >= 0
      ? rawDelay
      : DEFAULT_INTER_CALL_DELAY_SEC;

  return {
    autoDial: settings.diallerAutoDial === true,
    interCallDelaySec,
    synthTones: settings.diallerSynthTones === true,
  };
}
