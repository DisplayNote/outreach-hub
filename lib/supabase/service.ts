import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getServerEnv } from '@/lib/env';

/**
 * Service-role Supabase client — bypasses RLS. Use ONLY in trusted server code
 * that scopes every write explicitly (e.g. the Telnyx webhook route and the AMD
 * Server Actions, which set `org_id` from the attempt/run they loaded). Never
 * expose this client or its key to the browser.
 *
 * No cookies / no session: it authenticates with the service-role key, so it
 * must not be used for anything that should run under a user's RLS scope —
 * those paths use `@/lib/supabase/server` instead.
 */
export function createServiceClient(): SupabaseClient {
  const env = getServerEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('createServiceClient: SUPABASE_SERVICE_ROLE_KEY is not set');
  }
  return createClient(env.SUPABASE_SERVER_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
