import { describe, it, expect } from 'vitest';
import { isEmailMockEnabled, parseServerEnv } from '@/lib/env';

const baseEnv = {
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
};

describe('isEmailMockEnabled', () => {
  const enabled = { NODE_ENV: 'development', EMAIL_DRIVER: 'mock', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' };

  it('is true for mock/mailpit on a loopback URL in non-prod', () => {
    expect(isEmailMockEnabled(enabled)).toBe(true);
    expect(isEmailMockEnabled({ ...enabled, EMAIL_DRIVER: 'mailpit' })).toBe(true);
    expect(isEmailMockEnabled({ ...enabled, NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321' })).toBe(true);
  });

  it('is false for a real Graph driver, in production, or against a remote URL', () => {
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
