import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { getServerEnv, isAuthMockEnabled } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

// Dev-only mock sign-in. Seeds a deterministic local test user (idempotent) and
// establishes a real Supabase session for it, so the whole RLS-scoped app can be
// exercised without a Microsoft OAuth round-trip. Hard-gated by isAuthMockEnabled()
// — returns 404 in production or whenever AUTH_MOCK_ENABLED is not 'true'.

const MOCK_EMAIL = 'dev@outreach.local';
const MOCK_PASSWORD = 'dev-password-12345';

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAuthMockEnabled()) {
    return new NextResponse('Not found', { status: 404 });
  }

  const env = getServerEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return new NextResponse('Mock auth requires SUPABASE_SERVICE_ROLE_KEY (local only).', {
      status: 500,
    });
  }

  // Ensure the seed user exists (service role bypasses RLS). The on_auth_user_created
  // trigger creates its organization + public.users row on first insert.
  const admin = createAdminClient(env.SUPABASE_SERVER_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: createError } = await admin.auth.admin.createUser({
    email: MOCK_EMAIL,
    password: MOCK_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Dev User', org_name: 'Dev Org' },
  });
  // A repeat sign-in is expected to find the seed user already present. Match on
  // the stable AuthApiError contract (HTTP 422 / code 'email_exists') rather than
  // the human-readable message, which Supabase may reword.
  if (createError) {
    const status = (createError as { status?: number }).status;
    const code = (createError as { code?: string }).code;
    const alreadyExists = status === 422 || code === 'email_exists';
    if (!alreadyExists) {
      return new NextResponse(`Mock auth: could not seed user: ${createError.message}`, {
        status: 500,
      });
    }
  }

  // Sign in on the SSR client so the session cookies are written on the response.
  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: MOCK_EMAIL,
    password: MOCK_PASSWORD,
  });
  if (signInError) {
    return new NextResponse(`Mock auth: sign-in failed: ${signInError.message}`, { status: 500 });
  }

  const { origin } = new URL(request.url);
  return NextResponse.redirect(`${origin}/`, { status: 303 });
}
