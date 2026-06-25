import { describe, it, expect } from 'vitest';
import { extractEmail } from '@/lib/email/store';

// escapeLike lives in @/lib/db/like and is covered by tests/unit/db/like.test.ts.

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
