import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getServerEnv } from '@/lib/env';
import { SUPABASE_AUTH_COOKIE_NAME } from '@/lib/supabase/cookie-name';

// Paths reachable WITHOUT an authenticated session. The login/auth routes
// themselves, plus the API routes that authenticate by CRON_SECRET / Telnyx
// signature rather than a Supabase session — gating those on a user would break
// scheduled sending and inbound webhooks. Everything else redirects to /login.
const PUBLIC_PATH_PREFIXES = ['/login', '/auth/', '/api/email/', '/api/telnyx/'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({ request });
  const env = getServerEnv();

  const supabase = createServerClient(
    env.SUPABASE_SERVER_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookieOptions: { name: SUPABASE_AUTH_COOKIE_NAME },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // IMPORTANT: do not write any code between createServerClient and supabase.auth.getUser().
  // A simple mistake can make it very hard to debug issues with users being randomly logged out.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Centralized auth gate (defense-in-depth on top of per-page `if (!user)`
  // guards and RLS): an unauthenticated request to any non-public path is sent
  // to /login, so a route that forgets its own guard can't leak through. The
  // session-cookie refresh above still runs for public paths.
  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    return NextResponse.redirect(loginUrl);
  }

  return supabaseResponse;
}
