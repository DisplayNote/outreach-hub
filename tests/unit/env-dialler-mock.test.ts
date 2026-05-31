import { describe, expect, it } from 'vitest';
import { isDiallerMockEnabled, parseServerEnv } from '@/lib/env';

const baseEnv = {
  NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
};

describe('isDiallerMockEnabled', () => {
  const enabledEnv = {
    NODE_ENV: 'development',
    DIALLER_MOCK_ENABLED: 'true',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  };

  it('is true when non-prod, flag set, and Supabase URL is loopback', () => {
    expect(isDiallerMockEnabled(enabledEnv)).toBe(true);
    expect(isDiallerMockEnabled({ ...enabledEnv, NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321' })).toBe(true);
    // `new URL('http://[::1]:54321').hostname` === '[::1]' (brackets kept); both
    // '[::1]' and bare '::1' are in LOCAL_SUPABASE_HOSTS, so either form matches.
    expect(isDiallerMockEnabled({ ...enabledEnv, NEXT_PUBLIC_SUPABASE_URL: 'http://[::1]:54321' })).toBe(true);
  });

  it('is false in production even with the flag and a local URL', () => {
    expect(isDiallerMockEnabled({ ...enabledEnv, NODE_ENV: 'production' })).toBe(false);
  });

  it('is false when the flag is not exactly "true"', () => {
    expect(isDiallerMockEnabled({ ...enabledEnv, DIALLER_MOCK_ENABLED: 'false' })).toBe(false);
    expect(isDiallerMockEnabled({ ...enabledEnv, DIALLER_MOCK_ENABLED: undefined })).toBe(false);
  });

  it('is false when the Supabase URL is remote even with the flag set', () => {
    expect(isDiallerMockEnabled({ ...enabledEnv, NEXT_PUBLIC_SUPABASE_URL: 'https://abcd.supabase.co' })).toBe(false);
  });
});

describe('parseServerEnv — Telnyx + dialler vars', () => {
  it('defaults amdMode to premium and noAnswerMs to 22000 when unset', () => {
    const env = parseServerEnv(baseEnv);
    expect(env.AMD_MODE).toBe('premium');
    expect(env.NO_ANSWER_TIMEOUT_MS).toBe(22000);
  });

  it('treats blank Telnyx values as unset', () => {
    const env = parseServerEnv({
      ...baseEnv,
      TELNYX_API_KEY: '',
      TELNYX_CONNECTION_ID: '',
      TELNYX_PUBLIC_KEY: '',
      BRIDGE_SIP_USERNAME: '',
    });
    expect(env.TELNYX_API_KEY).toBeUndefined();
    expect(env.TELNYX_CONNECTION_ID).toBeUndefined();
    expect(env.TELNYX_PUBLIC_KEY).toBeUndefined();
    expect(env.BRIDGE_SIP_USERNAME).toBeUndefined();
  });

  it('coerces NO_ANSWER_TIMEOUT_MS from a string', () => {
    expect(parseServerEnv({ ...baseEnv, NO_ANSWER_TIMEOUT_MS: '30000' }).NO_ANSWER_TIMEOUT_MS).toBe(30000);
  });
});
