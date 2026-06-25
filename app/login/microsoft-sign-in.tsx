import { Icon } from '@/components/ui';
import { signIn } from '@/lib/auth/config';

// Server-rendered Microsoft sign-in button. Submits a form whose action is a
// server action wrapping Auth.js `signIn('microsoft-entra-id')` — no client-side
// auth SDK and no SessionProvider needed. The Mail scopes are requested by the
// provider config (lib/auth/config.ts), so the delegated Graph token is captured
// at login for the manual send/scan path.
export default function MicrosoftSignIn() {
  async function signInWithMicrosoft() {
    'use server';
    await signIn('microsoft-entra-id', { redirectTo: '/' });
  }

  return (
    <form action={signInWithMicrosoft}>
      <button
        type="submit"
        className="btn btn--secondary btn--lg"
        style={{ width: '100%', justifyContent: 'center' }}
      >
        <Icon name="microsoft" size={18} style={{ color: 'var(--teal-600)' }} />
        <span>Sign in with Microsoft</span>
      </button>
    </form>
  );
}
