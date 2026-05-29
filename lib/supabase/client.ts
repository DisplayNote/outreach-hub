import { createBrowserClient } from '@supabase/ssr';
import { getPublicEnv } from '@/lib/env';
import { SUPABASE_AUTH_COOKIE_NAME } from '@/lib/supabase/cookie-name';

export function createClient() {
  const env = getPublicEnv();
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookieOptions: { name: SUPABASE_AUTH_COOKIE_NAME },
  });
}
