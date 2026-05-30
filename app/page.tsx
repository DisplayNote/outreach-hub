import Link from 'next/link';
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
      <h1>Welcome, {user.email}</h1>
      <p style={{ color: '#666' }}>DisplayNote Outreach Hub.</p>

      <ul style={{ marginTop: '1.5rem', lineHeight: 1.9 }}>
        <li>
          <Link href="/today">Today</Link> — contacts due or overdue for follow-up.
        </li>
        <li>
          <Link href="/pipeline">Pipeline</Link> — contacts by status, across campaigns.
        </li>
      </ul>
    </main>
  );
}
