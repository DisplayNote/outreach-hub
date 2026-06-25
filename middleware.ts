// Auth.js v5 middleware gate. The `authorized` callback in lib/auth/config.ts
// decides access: it allows the hardened public-path allowlist (/login,
// /api/auth/, /api/email/, /api/telnyx/, /api/unsubscribe — exact-or-subtree
// match) and requires a session everywhere else, redirecting to /login.
export { auth as middleware } from '@/lib/auth/config';

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, public assets
     * - common static file extensions
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
