/**
 * Browser-synthesised dial/ring tones for the click-to-call dialler, ported
 * from the legacy PWA's Web Audio tone engine (`diallerTone` in
 * legacy/PaulsOutreachHub.html). Telnyx WebRTC does not always pipe network
 * ringback through to the browser audio stream, so users on networks that strip
 * it can opt into locally-generated tones via the `diallerSynthTones` setting.
 *
 * Each tone is generated on the fly (no audio assets to host/load). The player
 * is gated on a single `enabled` flag: when disabled every method is an inert
 * no-op, so callers can construct and drive it unconditionally and simply rely
 * on network ringback (the default behaviour).
 *
 * Pure TS with no Node/Next imports, so it is safe to instantiate inside a
 * `'use client'` component. The AudioContext factory is injectable for testing.
 */

/** A tone the player knows how to synthesise, keyed to a call lifecycle moment. */
export type ToneName = 'dialling' | 'ringing' | 'answered' | 'hangup';

/** Imperative handle for playing/stopping synthesised tones. */
export interface TonePlayer {
  /** Play `name`, stopping any currently-playing tone first. No-op when disabled. */
  play(name: ToneName): void;
  /** Stop any currently-playing tone (non-destructive pause). Idempotent; no-op when disabled. */
  stop(): void;
  /**
   * Stop and tear down the underlying AudioContext, releasing the audio thread.
   * Call from the consumer's unmount cleanup — browsers cap AudioContexts per
   * page, so leaking one per dialler mount eventually fails to allocate. A
   * subsequent `play()` lazily reopens a fresh context. No-op when disabled.
   */
  dispose(): void;
}

/** Lazily produces an AudioContext, or `null` if the API is unavailable. */
export type AudioContextFactory = () => AudioContext | null;

/** Default factory: the standard / webkit-prefixed AudioContext, guarded. */
function defaultAudioContextFactory(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

/**
 * Create a {@link TonePlayer}. When `enabled` is false the returned player is an
 * inert no-op (and never constructs an AudioContext). `makeContext` is injected
 * in tests; production passes the default Web Audio factory.
 */
export function createTonePlayer(
  enabled: boolean,
  makeContext: AudioContextFactory = defaultAudioContextFactory,
): TonePlayer {
  if (!enabled) {
    return { play: () => {}, stop: () => {}, dispose: () => {} };
  }

  let ctx: AudioContext | null = null;
  let osc: OscillatorNode | null = null;
  let osc2: OscillatorNode | null = null;
  let gain: GainNode | null = null;
  let stopTimer: ReturnType<typeof setInterval> | null = null;
  let endTimer: ReturnType<typeof setTimeout> | null = null;
  let active: ToneName | null = null;

  /** Lazily build the context, resuming it if the autoplay policy suspended it. */
  function context(): AudioContext | null {
    if (!ctx) ctx = makeContext();
    if (ctx && ctx.state === 'suspended') {
      try {
        void ctx.resume();
      } catch {
        // ignore — resume is best-effort
      }
    }
    return ctx;
  }

  function stop(): void {
    if (stopTimer) {
      clearInterval(stopTimer);
      stopTimer = null;
    }
    if (endTimer) {
      clearTimeout(endTimer);
      endTimer = null;
    }
    try {
      osc?.stop();
      osc?.disconnect();
    } catch {
      // already stopped
    }
    try {
      osc2?.stop();
      osc2?.disconnect();
    } catch {
      // already stopped
    }
    try {
      gain?.disconnect();
    } catch {
      // already disconnected
    }
    osc = null;
    osc2 = null;
    gain = null;
    active = null;
  }

  function dispose(): void {
    stop();
    if (ctx) {
      try {
        void ctx.close();
      } catch {
        // already closed / not supported — best-effort
      }
      // Drop the reference so a later play() lazily opens a fresh context
      // (matters under React StrictMode's mount→unmount→mount in dev).
      ctx = null;
    }
  }

  function play(name: ToneName): void {
    stop();
    const c = context();
    if (!c) return;
    active = name;
    gain = c.createGain();
    gain.gain.value = 0; // start silent, ramp up to avoid clicks
    gain.connect(c.destination);

    if (name === 'dialling') {
      // Single soft 350Hz beep.
      osc = c.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 350;
      osc.connect(gain);
      gain.gain.linearRampToValueAtTime(0.08, c.currentTime + 0.02);
      osc.start();
      endTimer = setTimeout(() => {
        if (active === 'dialling') stop();
      }, 400);
    } else if (name === 'ringing') {
      // UK ringback: 400Hz + 450Hz, two 0.4s rings 0.2s apart, then 2s silence.
      // Each burst needs fresh oscillators (a stopped OscillatorNode can't
      // restart), but they share the single `gain` created above for the
      // envelope — and are tracked in `osc`/`osc2` so `stop()` tears down the
      // in-flight burst, and disconnected on `onended` so the graph doesn't
      // accumulate dead nodes across the (potentially long) ringing period.
      const startBurst = (): void => {
        if (active !== 'ringing' || !ctx || !gain) return;
        try {
          const o1 = ctx.createOscillator();
          o1.type = 'sine';
          o1.frequency.value = 400;
          const o2 = ctx.createOscillator();
          o2.type = 'sine';
          o2.frequency.value = 450;
          o1.connect(gain);
          o2.connect(gain);
          const now = ctx.currentTime;
          // First ring (0.4s).
          gain.gain.setValueAtTime(0, now);
          gain.gain.linearRampToValueAtTime(0.08, now + 0.02);
          gain.gain.setValueAtTime(0.08, now + 0.38);
          gain.gain.linearRampToValueAtTime(0, now + 0.4);
          // Silence (0.2s), then second ring (0.4s).
          gain.gain.setValueAtTime(0, now + 0.6);
          gain.gain.linearRampToValueAtTime(0.08, now + 0.62);
          gain.gain.setValueAtTime(0.08, now + 0.98);
          gain.gain.linearRampToValueAtTime(0, now + 1.0);
          o1.start(now);
          o2.start(now);
          o1.stop(now + 1.0);
          o2.stop(now + 1.0);
          o1.onended = () => {
            try {
              o1.disconnect();
            } catch {
              // already disconnected
            }
          };
          o2.onended = () => {
            try {
              o2.disconnect();
            } catch {
              // already disconnected
            }
          };
          osc = o1;
          osc2 = o2;
        } catch {
          // transient Web Audio error — skip this burst
        }
      };
      startBurst();
      stopTimer = setInterval(startBurst, 3000); // UK cycle: 1s on, 2s off
    } else if (name === 'answered') {
      // Quick rising two-note chime.
      osc = c.createOscillator();
      osc.type = 'sine';
      osc.connect(gain);
      const now = c.currentTime;
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.linearRampToValueAtTime(900, now + 0.15);
      gain.gain.linearRampToValueAtTime(0.1, now + 0.02);
      gain.gain.setValueAtTime(0.1, now + 0.13);
      gain.gain.linearRampToValueAtTime(0, now + 0.18);
      osc.start();
      endTimer = setTimeout(() => {
        if (active === 'answered') stop();
      }, 250);
    } else {
      // 'hangup' — quick descending tone.
      osc = c.createOscillator();
      osc.type = 'sine';
      osc.connect(gain);
      const now = c.currentTime;
      osc.frequency.setValueAtTime(500, now);
      osc.frequency.linearRampToValueAtTime(250, now + 0.2);
      gain.gain.linearRampToValueAtTime(0.07, now + 0.02);
      gain.gain.setValueAtTime(0.07, now + 0.18);
      gain.gain.linearRampToValueAtTime(0, now + 0.22);
      osc.start();
      endTimer = setTimeout(() => {
        if (active === 'hangup') stop();
      }, 300);
    }
  }

  return { play, stop, dispose };
}
