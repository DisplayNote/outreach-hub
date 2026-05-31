import { describe, expect, it } from 'vitest';
import { isAuthMockEnabled, parseServerEnv } from '@/lib/env';

const baseEnv = {
  NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
};

describe('parseServerEnv', () => {
  it('defaults the server Supabase URL to the public Supabase URL', () => {
    expect(parseServerEnv(baseEnv).SUPABASE_SERVER_URL).toBe('http://localhost:54321');
  });

  it('uses SUPABASE_INTERNAL_URL for server-side Supabase calls when provided', () => {
    expect(
      parseServerEnv({
        ...baseEnv,
        SUPABASE_INTERNAL_URL: 'http://host.docker.internal:54321',
      }).SUPABASE_SERVER_URL,
    ).toBe('http://host.docker.internal:54321');
  });

  it('treats blank optional server-only values as unset', () => {
    const env = parseServerEnv({
      ...baseEnv,
      SUPABASE_INTERNAL_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
    });

    expect(env.SUPABASE_INTERNAL_URL).toBeUndefined();
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(env.SUPABASE_SERVER_URL).toBe(baseEnv.NEXT_PUBLIC_SUPABASE_URL);
  });
});

describe('isAuthMockEnabled', () => {
  const enabledEnv = {
    NODE_ENV: 'development',
    AUTH_MOCK_ENABLED: 'true',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  };

  it('is true when non-prod, flag set, and Supabase URL is loopback', () => {
    expect(isAuthMockEnabled(enabledEnv)).toBe(true);
    expect(isAuthMockEnabled({ ...enabledEnv, NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321' })).toBe(true);
    expect(isAuthMockEnabled({ ...enabledEnv, NEXT_PUBLIC_SUPABASE_URL: 'http://[::1]:54321' })).toBe(true);
  });

  it('is false in production even with the flag and a local URL', () => {
    expect(isAuthMockEnabled({ ...enabledEnv, NODE_ENV: 'production' })).toBe(false);
  });

  it('is false when the flag is not exactly "true"', () => {
    expect(isAuthMockEnabled({ ...enabledEnv, AUTH_MOCK_ENABLED: 'false' })).toBe(false);
    expect(isAuthMockEnabled({ ...enabledEnv, AUTH_MOCK_ENABLED: undefined })).toBe(false);
  });

  it('is false when the Supabase URL is not a loopback host (remote/staging)', () => {
    expect(isAuthMockEnabled({ ...enabledEnv, NEXT_PUBLIC_SUPABASE_URL: 'https://abcd.supabase.co' })).toBe(false);
    expect(isAuthMockEnabled({ ...enabledEnv, NEXT_PUBLIC_SUPABASE_URL: 'http://host.docker.internal:54321' })).toBe(false);
  });

  it('is false when the Supabase URL is missing or unparseable', () => {
    expect(isAuthMockEnabled({ ...enabledEnv, NEXT_PUBLIC_SUPABASE_URL: undefined })).toBe(false);
    expect(isAuthMockEnabled({ ...enabledEnv, NEXT_PUBLIC_SUPABASE_URL: 'not-a-url' })).toBe(false);
  });
});
