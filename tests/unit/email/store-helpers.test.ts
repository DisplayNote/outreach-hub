import { describe, it, expect } from 'vitest';
import { extractEmail, escapeLike } from '@/lib/email/store';

describe('extractEmail', () => {
  it('pulls the address from an angle-bracket display form and lowercases it', () => {
    expect(extractEmail('Mike Smith <Mike@Example.com>')).toBe('mike@example.com');
  });
  it('accepts a bare address', () => {
    expect(extractEmail('a@b.com')).toBe('a@b.com');
  });
  it('returns null for a non-address', () => {
    expect(extractEmail('not an email')).toBeNull();
  });
});

describe('escapeLike', () => {
  it('escapes SQL LIKE wildcards so an address matches literally', () => {
    // `_` and `%` would otherwise act as wildcards: a_b would match axb.
    expect(escapeLike('a_b@example.com')).toBe('a\\_b@example.com');
    expect(escapeLike('100%@example.com')).toBe('100\\%@example.com');
    expect(escapeLike('a\\b@example.com')).toBe('a\\\\b@example.com');
  });
  it('leaves a plain address unchanged', () => {
    expect(escapeLike('mike@example.com')).toBe('mike@example.com');
  });
});
