import { afterEach, describe, expect, it } from 'vitest';
// Import from lib/env (pure) — NOT lib/auth/admin, which pulls the Auth.js /
// next-auth chain (→ next/server) that can't load under vitest's node env.
import { getAdminEmails, isAdminEmail } from '@/lib/env';

describe('getAdminEmails', () => {
  it('returns [] when unset or blank', () => {
    expect(getAdminEmails({})).toEqual([]);
    expect(getAdminEmails({ ADMIN_EMAIL_ALLOWLIST: '' })).toEqual([]);
    expect(getAdminEmails({ ADMIN_EMAIL_ALLOWLIST: '   ' })).toEqual([]);
  });

  it('comma-splits, trims, lowercases, and drops blanks', () => {
    expect(
      getAdminEmails({ ADMIN_EMAIL_ALLOWLIST: ' Alice@X.com , ,BOB@x.com,' }),
    ).toEqual(['alice@x.com', 'bob@x.com']);
  });
});

describe('isAdminEmail', () => {
  const original = process.env.ADMIN_EMAIL_ALLOWLIST;
  afterEach(() => {
    if (original === undefined) delete process.env.ADMIN_EMAIL_ALLOWLIST;
    else process.env.ADMIN_EMAIL_ALLOWLIST = original;
  });

  it('is false for everyone when the allowlist is empty', () => {
    delete process.env.ADMIN_EMAIL_ALLOWLIST;
    expect(isAdminEmail('anyone@x.com')).toBe(false);
  });

  it('matches case-insensitively and rejects non-members and nullish input', () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = 'admin@displaynote.com';
    expect(isAdminEmail('ADMIN@displaynote.com')).toBe(true);
    expect(isAdminEmail('admin@displaynote.com')).toBe(true);
    expect(isAdminEmail('member@displaynote.com')).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
    expect(isAdminEmail('')).toBe(false);
  });
});
