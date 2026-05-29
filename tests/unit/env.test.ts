import { describe, expect, it } from 'vitest';
import { parseServerEnv } from '@/lib/env';

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
