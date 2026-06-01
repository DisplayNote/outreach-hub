import { describe, expect, it } from 'vitest';
import { DEFAULT_INTER_CALL_DELAY_SEC, resolveDiallerPrefs } from '@/lib/dialler/prefs';

/**
 * `resolveDiallerPrefs` normalises the three loose `UserSettings` dialler keys
 * into a fully-defaulted shape the client component can consume directly. The
 * contract is "default to current behaviour when unset": no auto-dial, network
 * ringback (no synth tones), and a safe inter-call delay.
 */
describe('resolveDiallerPrefs', () => {
  it('defaults to current behaviour when settings are empty', () => {
    expect(resolveDiallerPrefs({})).toEqual({
      autoDial: false,
      interCallDelaySec: DEFAULT_INTER_CALL_DELAY_SEC,
      synthTones: false,
    });
  });

  it('defaults the inter-call delay to a safe 3 seconds', () => {
    expect(DEFAULT_INTER_CALL_DELAY_SEC).toBe(3);
  });

  it('honours an explicit auto-dial preference', () => {
    expect(resolveDiallerPrefs({ diallerAutoDial: true }).autoDial).toBe(true);
  });

  it('honours an explicit synth-tones preference', () => {
    expect(resolveDiallerPrefs({ diallerSynthTones: true }).synthTones).toBe(true);
  });

  it('honours a valid positive inter-call delay', () => {
    expect(resolveDiallerPrefs({ diallerInterCallDelaySec: 10 }).interCallDelaySec).toBe(10);
  });

  it('honours an explicit zero delay (immediate auto-dial)', () => {
    expect(resolveDiallerPrefs({ diallerInterCallDelaySec: 0 }).interCallDelaySec).toBe(0);
  });

  it('falls back to the default for a negative, NaN, or infinite delay', () => {
    expect(resolveDiallerPrefs({ diallerInterCallDelaySec: -5 }).interCallDelaySec).toBe(
      DEFAULT_INTER_CALL_DELAY_SEC,
    );
    expect(resolveDiallerPrefs({ diallerInterCallDelaySec: Number.NaN }).interCallDelaySec).toBe(
      DEFAULT_INTER_CALL_DELAY_SEC,
    );
    expect(
      resolveDiallerPrefs({ diallerInterCallDelaySec: Number.POSITIVE_INFINITY }).interCallDelaySec,
    ).toBe(DEFAULT_INTER_CALL_DELAY_SEC);
  });
});
