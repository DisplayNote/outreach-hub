import { handlers } from '@/lib/auth/config';

// Auth.js v5 route handlers (sign-in, callback, sign-out, session, csrf, …).
// All auth traffic flows through /api/auth/* — which the middleware gate treats
// as a public subtree so the OAuth handshake itself is never blocked.
export const { GET, POST } = handlers;
