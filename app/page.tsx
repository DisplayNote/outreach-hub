import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

// Auth state changes per request; never prerender.
export const dynamic = 'force-dynamic';

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <main
      style={{
        padding: '2rem',
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 720,
        margin: '0 auto',
      }}
    >
      <h1>Hola {user.email}</h1>
      <p>Outreach Hub — Phase 0 OK.</p>

      <form action="/auth/signout" method="post" style={{ marginTop: '1.5rem' }}>
        <button
          type="submit"
          style={{
            padding: '0.5rem 1rem',
            cursor: 'pointer',
            background: '#eee',
            border: '1px solid #ccc',
            borderRadius: 4,
          }}
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
