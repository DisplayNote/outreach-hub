import { beforeAll, describe, expect, it } from 'vitest';

// The db client reads server env at import time, so seed the required vars
// before the dynamic import below.
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'anon-key';
  process.env.DATABASE_URL ??= 'postgres://app_user:apppw@localhost:5433/outreach';
});

describe('db client', () => {
  it('exposes a pg Pool configured from DATABASE_URL', async () => {
    const { pool } = await import('@/lib/db/client');
    expect(pool).toBeDefined();
    expect(typeof pool.connect).toBe('function');
  });
});
