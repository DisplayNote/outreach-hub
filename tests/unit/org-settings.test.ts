import { describe, expect, it } from 'vitest';
import { mergeOrgSettingsPatch } from '@/lib/org-settings';

describe('mergeOrgSettingsPatch', () => {
  it('overwrites existing keys with defined patch values', () => {
    const merged = mergeOrgSettingsPatch({ dailyGoal: 5, signature: 'old' }, { signature: 'new' });
    expect(merged).toEqual({ dailyGoal: 5, signature: 'new' });
  });

  it('skips undefined patch values so blank fields do not delete stored values', () => {
    const merged = mergeOrgSettingsPatch(
      { dailyGoal: 5, signature: 'keep' },
      { dailyGoal: undefined, signature: undefined, seqSkipWeekends: true },
    );
    expect(merged).toEqual({ dailyGoal: 5, signature: 'keep', seqSkipWeekends: true });
    // The stored values survive JSON serialisation (the original bug dropped them).
    expect('dailyGoal' in JSON.parse(JSON.stringify(merged))).toBe(true);
  });

  it('adds new keys not present in existing settings', () => {
    expect(mergeOrgSettingsPatch({}, { defaultCountryCode: '+44' })).toEqual({
      defaultCountryCode: '+44',
    });
  });

  it('does not mutate the existing object', () => {
    const existing = { dailyGoal: 5 };
    mergeOrgSettingsPatch(existing, { dailyGoal: 9 });
    expect(existing).toEqual({ dailyGoal: 5 });
  });

  it('does not allow a __proto__ key in the patch to pollute Object.prototype', () => {
    // JSON.parse yields a real own "__proto__" key (not the accessor).
    const maliciousPatch = JSON.parse('{"__proto__": {"polluted": true}}') as Record<string, unknown>;
    const merged = mergeOrgSettingsPatch({}, maliciousPatch);
    expect((merged as Record<string, unknown>)['__proto__']).toEqual({ polluted: true });
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});
