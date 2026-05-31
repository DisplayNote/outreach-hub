import { describe, expect, it } from 'vitest';
import {
  CALL_OUTCOME_KEYS,
  getDiallerOutcomes,
  getOutcomeDef,
  outcomeSchedulesCallback,
  resolveStatusEffect,
} from '@/lib/dialler/outcomes';

describe('getDiallerOutcomes', () => {
  it('returns the full catalogue keyed in CALL_OUTCOME_KEYS order', () => {
    const outcomes = getDiallerOutcomes();
    expect(outcomes.map((o) => o.key)).toEqual(CALL_OUTCOME_KEYS);
    expect(outcomes).toHaveLength(8);
  });

  it('returns a fresh array on each call (callers may sort/filter safely)', () => {
    const a = getDiallerOutcomes();
    const b = getDiallerOutcomes();
    expect(a).not.toBe(b);
    a.sort((x, y) => x.label.localeCompare(y.label));
    // Mutating the first result must not affect a subsequent call.
    expect(getDiallerOutcomes().map((o) => o.key)).toEqual(CALL_OUTCOME_KEYS);
  });

  it('matches getOutcomeDef for every key', () => {
    for (const o of getDiallerOutcomes()) {
      const def = getOutcomeDef(o.key);
      expect(def.label).toBe(o.label);
      expect(def.statusEffect).toBe(o.statusEffect);
      expect(def.defaultNote).toBe(o.defaultNote);
    }
  });
});

describe('resolveStatusEffect', () => {
  it("'none' effect never changes status", () => {
    expect(resolveStatusEffect('amber', 'none')).toBeNull();
    expect(resolveStatusEffect('green', 'none')).toBeNull();
  });

  it('green advances weaker/neutral statuses', () => {
    expect(resolveStatusEffect('none', 'green')).toBe('green');
    expect(resolveStatusEffect('amber', 'green')).toBe('green');
    expect(resolveStatusEffect('red', 'green')).toBe('green');
  });

  it('green never downgrades a stronger terminal state (spec §3 DECISION 3)', () => {
    expect(resolveStatusEffect('meeting', 'green')).toBeNull();
    expect(resolveStatusEffect('notinterested', 'green')).toBeNull();
    expect(resolveStatusEffect('bounced', 'green')).toBeNull();
  });

  it('explicit terminal effects always apply', () => {
    expect(resolveStatusEffect('green', 'meeting')).toBe('meeting');
    expect(resolveStatusEffect('amber', 'notinterested')).toBe('notinterested');
    expect(resolveStatusEffect('green', 'bounced')).toBe('bounced');
  });

  it('skips a no-op write when the effect equals the current status', () => {
    expect(resolveStatusEffect('green', 'green')).toBeNull();
    expect(resolveStatusEffect('meeting', 'meeting')).toBeNull();
  });
});

describe('outcomeSchedulesCallback', () => {
  it('is true only for callback-requested', () => {
    expect(outcomeSchedulesCallback('callback-requested')).toBe(true);
    for (const key of CALL_OUTCOME_KEYS.filter((k) => k !== 'callback-requested')) {
      expect(outcomeSchedulesCallback(key)).toBe(false);
    }
  });
});
