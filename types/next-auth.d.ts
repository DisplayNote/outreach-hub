// Module augmentation for Auth.js (next-auth v5): teach the Session.user and
// JWT types about the org-scoped identity claims our jwt/session callbacks set
// (id/orgId/role/email). The Graph delegated tokens are deliberately NOT here:
// they live server-side in public.user_graph_tokens, never on the session/JWT,
// so they cannot leak via GET /api/auth/session.

import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id?: string;
      orgId?: string;
      role?: string;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string;
    orgId?: string;
    role?: string;
    email?: string;
  }
}
