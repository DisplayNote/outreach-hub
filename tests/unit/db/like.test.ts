import { describe, expect, it } from 'vitest';
import { escapeLike } from '@/lib/db/like';

describe('escapeLike', () => {
  it('leaves ordinary values untouched', () => {
    expect(escapeLike('alice@example.com')).toBe('alice@example.com');
  });

  it('escapes the % wildcard so it matches literally', () => {
    expect(escapeLike('a%b@example.com')).toBe('a\\%b@example.com');
  });

  it('escapes the _ single-char wildcard', () => {
    expect(escapeLike('a_b@example.com')).toBe('a\\_b@example.com');
  });

  it('escapes a literal backslash first so escapes are not doubled wrong', () => {
    expect(escapeLike('a\\b')).toBe('a\\\\b');
  });

  it('escapes every metacharacter in a mixed string', () => {
    expect(escapeLike('100%_\\done')).toBe('100\\%\\_\\\\done');
  });
});
