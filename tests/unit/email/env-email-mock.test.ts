import { describe, it, expect } from 'vitest';
import { isEmailMockEnabled, parseServerEnv } from '@/lib/env';

const baseEnv = {
  DATABASE_URL: 'postgres://app_user:apppw@localhost:5433/outreach',
};

describe('isEmailMockEnabled', () => {
  const enabled = { NODE_ENV: 'development', EMAIL_DRIVER: 'mock', APP_BASE_URL: 'http://127.0.0.1:3000' };

  it('is true for the mock driver (or unset, which defaults to mock) on a loopback URL in non-prod', () => {
    expect(isEmailMockEnabled(enabled)).toBe(true);
    expect(isEmailMockEnabled({ ...enabled, APP_BASE_URL: 'http://localhost:3000' })).toBe(true);
    // Unset EMAIL_DRIVER mirrors the factory default (mock).
    const { EMAIL_DRIVER: _omit, ...noDriver } = enabled;
    expect(isEmailMockEnabled(noDriver)).toBe(true);
  });

  it('is false for mailpit/graph drivers, in production, or against a deployed origin', () => {
    // mailpit's fetchReplies reads the real Mailpit API, not the dev inbox the
    // simulator writes to — so the simulate affordance must stay off there.
    expect(isEmailMockEnabled({ ...enabled, EMAIL_DRIVER: 'mailpit' })).toBe(false);
    expect(isEmailMockEnabled({ ...enabled, EMAIL_DRIVER: 'graph-dev' })).toBe(false);
    expect(isEmailMockEnabled({ ...enabled, NODE_ENV: 'production' })).toBe(false);
    expect(isEmailMockEnabled({ ...enabled, APP_BASE_URL: 'https://outreach.displaynote.com' })).toBe(false);
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
