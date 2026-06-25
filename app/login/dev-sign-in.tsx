import { Icon } from '@/components/ui';
import { signIn } from '@/lib/auth/config';

// LOCAL-DEV sign-in button. Signs in a seeded developer identity via the Auth.js
// `dev-credentials` provider (no Microsoft round-trip) so the RLS-scoped app and
// e2e/unit flows run locally. This component is only rendered by the login page
// when isAuthMockEnabled() — the triple-gate (non-prod + AUTH_MOCK_ENABLED +
// loopback APP_BASE_URL) — and the provider itself is only registered under the
// same gate, so the path is doubly impossible to reach in production.
export default function DevSignIn() {
  async function signInAsDev() {
    'use server';
    await signIn('dev-credentials', { email: 'dev@outreach.local', redirectTo: '/' });
  }

  return (
    <form action={signInAsDev}>
      <button
        type="submit"
        className="btn btn--ghost btn--md"
        style={{ width: '100%', justifyContent: 'center' }}
      >
        <Icon name="flask" size={15} />
        Dev sign-in (mock)
      </button>
    </form>
  );
}
