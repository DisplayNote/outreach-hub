'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function MicrosoftSignIn() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    setPending(true);
    setError(null);

    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        // Phase 0: User.Read only. Mail.Send / Mail.Read are requested incrementally in Phase 5.
        scopes: 'email openid profile User.Read offline_access',
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (oauthError) {
      setError(oauthError.message);
      setPending(false);
    }
  }

  return (
    <>
      <button
        onClick={handleSignIn}
        disabled={pending}
        style={{
          marginTop: '1.5rem',
          padding: '0.75rem 1.25rem',
          fontSize: '1rem',
          cursor: pending ? 'not-allowed' : 'pointer',
          background: '#2f2f2f',
          color: 'white',
          border: 0,
          borderRadius: 4,
        }}
      >
        {pending ? 'Redirecting…' : 'Sign in with Microsoft'}
      </button>

      {error ? (
        <p role="alert" style={{ color: '#b00020', marginTop: '1rem' }}>
          {error}
        </p>
      ) : null}
    </>
  );
}
