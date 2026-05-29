import { isAuthMockEnabled } from '@/lib/env';
import MicrosoftSignIn from './microsoft-sign-in';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  const mockEnabled = isAuthMockEnabled();

  return (
    <main
      style={{
        padding: '4rem 2rem',
        maxWidth: 480,
        margin: '0 auto',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1>Sign in</h1>
      <p>Outreach Hub uses your Microsoft 365 account.</p>

      <MicrosoftSignIn />

      {mockEnabled ? (
        <div
          style={{
            marginTop: '2rem',
            paddingTop: '1.5rem',
            borderTop: '1px dashed #ccc',
          }}
        >
          <p style={{ color: '#666', fontSize: '0.9rem', margin: '0 0 0.75rem' }}>
            Local development only — signs in as a seeded test user, no Microsoft required.
          </p>
          <form action="/auth/mock" method="post">
            <button
              type="submit"
              style={{
                padding: '0.6rem 1rem',
                fontSize: '0.95rem',
                cursor: 'pointer',
                background: '#f3f4f6',
                color: '#111',
                border: '1px solid #d1d5db',
                borderRadius: 4,
              }}
            >
              Dev sign-in (mock)
            </button>
          </form>
        </div>
      ) : null}
    </main>
  );
}
