import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createSequence } from '@/lib/actions/sequences';

// Auth state changes per request; never prerender (ADR 004).
export const dynamic = 'force-dynamic';

const mainStyle: React.CSSProperties = {
  padding: '2rem',
  fontFamily: 'system-ui, sans-serif',
  maxWidth: 720,
  margin: '0 auto',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8125rem',
  fontWeight: 600,
  color: '#374151',
  marginBottom: '0.35rem',
};

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.625rem',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  fontSize: '0.9375rem',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

const submitStyle: React.CSSProperties = {
  padding: '0.55rem 1.25rem',
  background: '#111',
  color: '#fff',
  border: '1px solid #111',
  borderRadius: 4,
  fontSize: '0.9375rem',
  fontWeight: 600,
  cursor: 'pointer',
};

const cancelStyle: React.CSSProperties = {
  padding: '0.55rem 1.25rem',
  background: '#fff',
  color: '#374151',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  fontSize: '0.9375rem',
  textDecoration: 'none',
  display: 'inline-block',
};

export default async function NewSequencePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Server Action bound to the form. Creates the sequence (org_id is set inside
  // createSequence) and redirects to its editor so steps can be added next.
  async function action(formData: FormData): Promise<void> {
    'use server';

    const sequence = await createSequence({
      name: String(formData.get('name') ?? '').trim(),
    });
    redirect(`/sequences/${sequence.id}`);
  }

  return (
    <main style={mainStyle}>
      <h1 style={{ marginBottom: '0.25rem' }}>New sequence</h1>
      <p style={{ marginTop: 0, marginBottom: '1.5rem', color: '#666' }}>
        Name a sequence, then add its ordered steps.
      </p>

      <form action={action} style={{ fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ marginBottom: '1.1rem' }}>
          <label htmlFor="name" style={labelStyle}>
            Name *
          </label>
          <input id="name" name="name" type="text" required autoFocus style={fieldStyle} />
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
          <button type="submit" style={submitStyle}>
            Create sequence
          </button>
          <Link href="/sequences" style={cancelStyle}>
            Cancel
          </Link>
        </div>
      </form>
    </main>
  );
}
