import NextAuth, { type NextAuthConfig } from 'next-auth';
import EntraID from 'next-auth/providers/microsoft-entra-id';
import Credentials from 'next-auth/providers/credentials';
import { getServerEnv, isAuthMockEnabled } from '@/lib/env';
import { provisionUser } from '@/lib/auth/provision';
import { storeGraphTokens } from '@/lib/auth/graph-tokens';

const env = getServerEnv();
const isProduction = process.env.NODE_ENV === 'production';

// Fail closed in production: the ENTIRE RLS scoping chain trusts the signed JWT
// (orgId/userId/role flow into the withRls GUCs), so a missing AUTH_SECRET — and
// the dev fallback below — would sign sessions with a public constant and let an
// attacker forge any org/role. Likewise the issuer must be tenant-pinned (not
// "common") in prod, or any Microsoft tenant could self-provision an org.
if (isProduction && !env.AUTH_SECRET) {
  throw new Error('AUTH_SECRET is required in production (it signs the session JWT that RLS trusts).');
}
if (isProduction && !env.AZURE_AD_TENANT_ID) {
  throw new Error('AZURE_AD_TENANT_ID is required in production (the Entra issuer must be tenant-pinned, not "common").');
}
const authSecret = env.AUTH_SECRET ?? 'dev-insecure-secret-set-AUTH_SECRET';

// Public paths reachable WITHOUT an authenticated session. The login + Auth.js
// routes themselves, plus API routes that authenticate by their own mechanism
// (CRON_SECRET, Telnyx signature, unsubscribe token) rather than a user
// session — gating those on a user would break scheduled sending, inbound
// webhooks, and one-click unsubscribe. Everything else redirects to /login.
//
// HARDENED MATCH: exact path OR a path strictly UNDER the prefix (subtree),
// never a sibling that merely shares the prefix string — so '/api/unsubscribe'
// can't also expose a future '/api/unsubscribe-admin'. Mirrors the retired
// Supabase middleware allowlist exactly.
const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/api/auth/',
  '/api/email/',
  '/api/telnyx/',
  '/api/unsubscribe',
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) =>
      pathname === prefix ||
      pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`),
  );
}

// Build the provider list. The Entra provider is always present. The dev
// Credentials provider is added ONLY when isAuthMockEnabled() — the same
// triple-gate used elsewhere: NON-production AND AUTH_MOCK_ENABLED=true AND the
// configured Supabase URL is loopback. It is therefore impossible to enable in
// production (NODE_ENV gate) regardless of how the other flags are set,
// preserving the security property that no auth backdoor is reachable in prod.
const providers: NextAuthConfig['providers'] = [
  EntraID({
    clientId: env.AZURE_AD_CLIENT_ID ?? '',
    clientSecret: env.AZURE_AD_CLIENT_SECRET ?? '',
    issuer: `https://login.microsoftonline.com/${env.AZURE_AD_TENANT_ID ?? 'common'}/v2.0`,
    authorization: {
      params: {
        scope: 'openid profile email offline_access User.Read Mail.Send Mail.Read',
      },
    },
  }),
];

if (isAuthMockEnabled()) {
  providers.push(
    Credentials({
      id: 'dev-credentials',
      name: 'Dev sign-in',
      // No real secret check: this is a local-only convenience that signs in a
      // seeded developer identity so the RLS-scoped app, unit/e2e tests can run
      // without a live Entra round-trip. Hard-gated above; never present in prod.
      credentials: {
        email: { label: 'Email', type: 'email' },
      },
      authorize(raw) {
        const email =
          typeof raw?.email === 'string' && raw.email.trim()
            ? raw.email.trim()
            : 'dev@outreach.local';
        // Return a minimal user; provisioning + org/role resolution happen in
        // the jwt callback, the same path the Entra provider takes.
        return { id: email, email, name: 'Dev User' };
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  // Signs the JWT. Real value required in production (guarded above); the
  // dev fallback only ever applies in non-production.
  secret: authSecret,
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  callbacks: {
    // Middleware gate (see middleware.ts: `export { auth as middleware }`).
    // Allow the public allowlist unconditionally; require a session everywhere
    // else. Returning a Response here would let us redirect, but returning the
    // boolean lets Auth.js redirect to `pages.signIn` with a callbackUrl.
    authorized({ request, auth: session }) {
      const { pathname } = request.nextUrl;
      if (isPublicPath(pathname)) return true;
      return Boolean(session?.user);
    },
    async jwt({ token, account, profile, user }) {
      // First login / re-auth (account is only present then): capture the Graph
      // delegated tokens and provision the org + user row. On subsequent
      // requests the token already carries everything, so we skip the DB call.
      if (account) {
        // Resolve the signing-in email from the OAuth profile (Entra) or the
        // Credentials user (dev). Then provision idempotently → { userId, orgId,
        // role } and pin them on the JWT for RLS context + the admin gate.
        const email =
          (typeof profile?.email === 'string' && profile.email) ||
          (typeof token.email === 'string' && token.email) ||
          (typeof user?.email === 'string' && user.email) ||
          '';
        const name =
          (typeof profile?.name === 'string' && profile.name) ||
          (typeof user?.name === 'string' && user.name) ||
          undefined;
        if (email) {
          const provisioned = await provisionUser(
            name ? { email, name } : { email },
          );
          token.userId = provisioned.userId;
          token.orgId = provisioned.orgId;
          token.role = provisioned.role;
          token.email = email;

          // Persist the delegated Graph tokens SERVER-SIDE (own RLS-scoped row),
          // never on the JWT/session — so they can't be read via /api/auth/session.
          // lib/graph/token.ts reads them back. Phase 4 adds refresh-on-expiry.
          await storeGraphTokens(
            { userId: provisioned.userId, orgId: provisioned.orgId },
            {
              accessToken: account.access_token ?? null,
              refreshToken: account.refresh_token ?? null,
              expiresAt: account.expires_at ?? null,
            },
          );
        }
      }
      return token;
    },
    session({ session, token }) {
      // Project the JWT identity claims onto session.user so server code
      // (getSession/requireSession, requireAdmin) reads a typed AppSession.
      if (session.user) {
        if (typeof token.userId === 'string') session.user.id = token.userId;
        if (typeof token.orgId === 'string') session.user.orgId = token.orgId;
        if (typeof token.role === 'string') session.user.role = token.role;
        if (typeof token.email === 'string') session.user.email = token.email;
      }
      // The Graph delegated token is deliberately NOT projected here — it lives
      // server-side in public.user_graph_tokens (read via lib/graph/token.ts),
      // so it can never leak through GET /api/auth/session.
      return session;
    },
  },
});
