import { describe, expect, it } from 'vitest';
import { isAuthMockEnabled, parseServerEnv } from '@/lib/env';

const baseEnv = {
  DATABASE_URL: 'postgres://app_user:apppw@localhost:5433/outreach',
};

describe('parseServerEnv', () => {
  it('parses with only DATABASE_URL present', () => {
    expect(parseServerEnv(baseEnv).DATABASE_URL).toBe(baseEnv.DATABASE_URL);
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => parseServerEnv({})).toThrow(/DATABASE_URL/);
  });

  it('defaults EMAIL_DRIVER to mock', () => {
    expect(parseServerEnv(baseEnv).EMAIL_DRIVER).toBe('mock');
  });
});

describe('isAuthMockEnabled', () => {
  const enabledEnv = {
    NODE_ENV: 'development',
    AUTH_MOCK_ENABLED: 'true',
    APP_BASE_URL: 'http://127.0.0.1:3000',
  };

  it('is true when non-prod, flag set, and APP_BASE_URL is loopback', () => {
    expect(isAuthMockEnabled(enabledEnv)).toBe(true);
    expect(isAuthMockEnabled({ ...enabledEnv, APP_BASE_URL: 'http://localhost:3000' })).toBe(true);
    expect(isAuthMockEnabled({ ...enabledEnv, APP_BASE_URL: 'http://[::1]:3000' })).toBe(true);
  });

  it('is true when APP_BASE_URL is unset (bare local next dev)', () => {
    const { APP_BASE_URL: _omit, ...noBase } = enabledEnv;
    expect(isAuthMockEnabled(noBase)).toBe(true);
  });

  it('is false in production even with the flag and a local URL', () => {
    expect(isAuthMockEnabled({ ...enabledEnv, NODE_ENV: 'production' })).toBe(false);
  });

  it('is false when the flag is not exactly "true"', () => {
    expect(isAuthMockEnabled({ ...enabledEnv, AUTH_MOCK_ENABLED: 'false' })).toBe(false);
    expect(isAuthMockEnabled({ ...enabledEnv, AUTH_MOCK_ENABLED: undefined })).toBe(false);
  });

  it('is false when APP_BASE_URL is a deployed (non-loopback) origin', () => {
    expect(isAuthMockEnabled({ ...enabledEnv, APP_BASE_URL: 'https://outreach.displaynote.com' })).toBe(false);
    expect(isAuthMockEnabled({ ...enabledEnv, APP_BASE_URL: 'http://host.docker.internal:3000' })).toBe(false);
  });

  it('is false when APP_BASE_URL is set but unparseable', () => {
    expect(isAuthMockEnabled({ ...enabledEnv, APP_BASE_URL: 'not-a-url' })).toBe(false);
  });
});
