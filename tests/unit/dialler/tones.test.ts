import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTonePlayer } from '@/lib/dialler/tones';

/**
 * Browser-synthesised dial/ring tones, ported from the legacy PWA's Web Audio
 * tone engine. The player is gated on a single `enabled` flag (the user's
 * `diallerSynthTones` pref): when disabled it must be an inert no-op so callers
 * can wire it unconditionally and rely on Telnyx network ringback.
 *
 * We inject a fake AudioContext so the lifecycle is observable without real
 * audio hardware (happy-dom has no Web Audio API).
 */

interface FakeOsc {
  type: string;
  frequency: { value: number; setValueAtTime: ReturnType<typeof vi.fn>; linearRampToValueAtTime: ReturnType<typeof vi.fn> };
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

function makeFakeContext() {
  const oscillators: FakeOsc[] = [];
  const resume = vi.fn();
  const ctx = {
    state: 'running' as AudioContextState,
    currentTime: 0,
    destination: { id: 'dest' },
    resume,
    createOscillator(): FakeOsc {
      const osc: FakeOsc = {
        type: '',
        frequency: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        disconnect: vi.fn(),
      };
      oscillators.push(osc);
      return osc;
    },
    createGain() {
      return {
        gain: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
    },
  };
  return { ctx, oscillators, resume };
}

describe('createTonePlayer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('is an inert no-op when disabled — never touches the audio context', () => {
    const makeContext = vi.fn(() => makeFakeContext().ctx as unknown as AudioContext);
    const player = createTonePlayer(false, makeContext);

    player.play('dialling');
    player.stop();

    expect(makeContext).not.toHaveBeenCalled();
  });

  it('synthesises a 350Hz sine beep for the dialling tone when enabled', () => {
    const fake = makeFakeContext();
    const player = createTonePlayer(true, () => fake.ctx as unknown as AudioContext);

    player.play('dialling');

    expect(fake.oscillators).toHaveLength(1);
    const osc = fake.oscillators[0]!;
    expect(osc.type).toBe('sine');
    expect(osc.frequency.value).toBe(350);
    expect(osc.start).toHaveBeenCalled();

    player.stop();
  });

  it('stops the previous tone before starting a new one', () => {
    const fake = makeFakeContext();
    const player = createTonePlayer(true, () => fake.ctx as unknown as AudioContext);

    player.play('dialling');
    const first = fake.oscillators[0]!;
    player.play('answered');

    expect(first.stop).toHaveBeenCalled();
    expect(fake.oscillators.length).toBeGreaterThanOrEqual(2);

    player.stop();
  });

  it('stops the active oscillator on stop()', () => {
    const fake = makeFakeContext();
    const player = createTonePlayer(true, () => fake.ctx as unknown as AudioContext);

    player.play('dialling');
    const osc = fake.oscillators[0]!;
    player.stop();

    expect(osc.stop).toHaveBeenCalled();
  });

  it('does not throw when no AudioContext is available', () => {
    const player = createTonePlayer(true, () => null);
    expect(() => {
      player.play('dialling');
      player.stop();
    }).not.toThrow();
  });

  it('resumes a suspended context (autoplay policy)', () => {
    const fake = makeFakeContext();
    fake.ctx.state = 'suspended';
    const player = createTonePlayer(true, () => fake.ctx as unknown as AudioContext);

    player.play('dialling');

    expect(fake.resume).toHaveBeenCalled();
    player.stop();
  });
});
