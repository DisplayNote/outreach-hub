// Module augmentation for Auth.js (next-auth v5): teach the Session.user and
// JWT types about the org-scoped identity claims our jwt/session callbacks set
// (id/orgId/role/email on the user; the matching token fields + the interim
// Graph delegated-token fields on the JWT). Without this, reading
// `session.user.orgId` or `token.userId` would not type-check under strict.

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
    // INTERIM (Phase 4 adds refresh): Graph delegated tokens captured at login.
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
  }
}
