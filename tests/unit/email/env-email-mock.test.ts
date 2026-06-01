import { describe, it, expect } from 'vitest';
import { isEmailMockEnabled, parseServerEnv } from '@/lib/env';

const baseEnv = {
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
};

describe('isEmailMockEnabled', () => {
  const enabled = { NODE_ENV: 'development', EMAIL_DRIVER: 'mock', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' };

  it('is true for the mock driver (or unset, which defaults to mock) on a loopback URL in non-prod', () => {
    expect(isEmailMockEnabled(enabled)).toBe(true);
    expect(isEmailMockEnabled({ ...enabled, NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321' })).toBe(true);
    // Unset EMAIL_DRIVER mirrors the factory default (mock).
    const { EMAIL_DRIVER: _omit, ...noDriver } = enabled;
    expect(isEmailMockEnabled(noDriver)).toBe(true);
  });

  it('is false for mailpit/graph drivers, in production, or against a remote URL', () => {
    // mailpit's fetchReplies reads the real Mailpit API, not the dev inbox the
    // simulator writes to — so the simulate affordance must stay off there.
    expect(isEmailMockEnabled({ ...enabled, EMAIL_DRIVER: 'mailpit' })).toBe(false);
    expect(isEmailMockEnabled({ ...enabled, EMAIL_DRIVER: 'graph-dev' })).toBe(false);
    expect(isEmailMockEnabled({ ...enabled, NODE_ENV: 'production' })).toBe(false);
    expect(isEmailMockEnabled({ ...enabled, NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co' })).toBe(false);
  });
});

describe('parseServerEnv — CRON_SECRET', () => {
  it('treats a blank CRON_SECRET as unset', () => {
    expect(parseServerEnv({ ...baseEnv, CRON_SECRET: '' }).CRON_SECRET).toBeUndefined();
  });
  it('keeps a provided CRON_SECRET', () => {
    expect(parseServerEnv({ ...baseEnv, CRON_SECRET: 's3cret' }).CRON_SECRET).toBe('s3cret');
  });
});
