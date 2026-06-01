'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Icon } from '@/components/ui';

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
        type="button"
        className="btn btn--secondary btn--lg"
        style={{ width: '100%', justifyContent: 'center' }}
        onClick={handleSignIn}
        disabled={pending}
      >
        {pending ? (
          <span className="btn__spinner" style={{ color: 'var(--text-secondary)' }} />
        ) : (
          <Icon name="microsoft" size={18} style={{ color: 'var(--teal-600)' }} />
        )}
        <span>Sign in with Microsoft</span>
      </button>

      {error ? (
        <p role="alert" style={{ color: 'var(--red-600)', marginTop: 'var(--space-5)' }}>
          {error}
        </p>
      ) : null}
    </>
  );
}
