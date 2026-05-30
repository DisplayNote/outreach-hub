import { describe, expect, it } from 'vitest';
import { normaliseCallingCode, normalisePhone, pickDialNumber } from '@/lib/dialler/normalise';

describe('normalisePhone', () => {
  // The §4 table from docs/PHASE_3_SPEC.md, plus the no-double-CC case.
  it.each([
    ['+44 7783 191491', '+447783191491', 'leading + → trust, strip separators'],
    ['+447783191491', '+447783191491', 'already E.164'],
    ['00447783191491', '+447783191491', '00 exit-code → +'],
    ['0044 7783 191491', '+447783191491', '00 with separators'],
    ['07783191491', '+447783191491', 'local: strip leading 0, prepend CC'],
    ['7783191491', '+447783191491', 'raw: prepend default CC'],
    ['447783191491', '+447783191491', 'already CC-prefixed without + → no doubling'],
  ])('normalises %s → %s (%s)', (input, expected) => {
    expect(normalisePhone(input)).toBe(expected);
  });

  it('returns null for empty / digit-less input', () => {
    expect(normalisePhone('')).toBeNull();
    expect(normalisePhone('   ')).toBeNull();
    expect(normalisePhone('n/a')).toBeNull();
  });

  it('honours a custom default country code', () => {
    expect(normalisePhone('0151234567', '+1')).toBe('+1151234567');
    expect(normalisePhone('5551234', '353')).toBe('+3535551234');
  });
});

describe('pickDialNumber', () => {
  it('prefers mobile over the landline phone', () => {
    expect(pickDialNumber({ mobile: '07700900123', phone: '02012345678' })).toBe('+447700900123');
  });

  it('falls back to phone when mobile is null/blank', () => {
    expect(pickDialNumber({ mobile: null, phone: '02012345678' })).toBe('+442012345678');
    expect(pickDialNumber({ mobile: '   ', phone: '02012345678' })).toBe('+442012345678');
  });

  it('returns null when neither number is usable', () => {
    expect(pickDialNumber({ mobile: null, phone: null })).toBeNull();
    expect(pickDialNumber({ mobile: '', phone: '' })).toBeNull();
  });
});

describe('normaliseCallingCode', () => {
  it.each([
    ['+44', '+44', 'already canonical'],
    ['44', '+44', 'bare digits → prepend +'],
    [' +1 ', '+1', 'trims surrounding whitespace'],
    ['353', '+353', 'three-digit calling code'],
  ])('normalises %s → %s (%s)', (input, expected) => {
    expect(normaliseCallingCode(input)).toBe(expected);
  });

  it.each([
    ['GB', 'ISO country code, not a calling code'],
    ['US', 'ISO country code'],
    ['', 'empty string'],
    ['+', 'plus with no digits'],
    ['12345', 'too many digits'],
    ['+44a', 'trailing non-digit'],
  ])('rejects %s (%s)', (input) => {
    expect(normaliseCallingCode(input)).toBeNull();
  });
});
