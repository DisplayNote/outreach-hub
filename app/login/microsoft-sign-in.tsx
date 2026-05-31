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
        // Phase 5: request the Graph Mail scopes at login so the delegated
        // session token (session.provider_token) can drive the manual Graph
        // send/scan path — without them, those calls 403 with insufficient
        // privileges. Requires the Azure app's admin consent for Mail.Send /
        // Mail.Read (the IT-ticket grant, a deploy prerequisite); local/CI use
        // the mock driver and never exercise this. offline_access keeps the
        // refresh token for the (deferred) durable token storage.
        scopes: 'email openid profile User.Read Mail.Send Mail.Read offline_access',
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
