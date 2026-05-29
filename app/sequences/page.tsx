import Link from 'next/link';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { listSequences } from '@/lib/supabase/queries';
import { deleteSequence } from '@/lib/actions/sequences';

// Auth state + the sequence list change per request; never prerender (ADR 004).
export const dynamic = 'force-dynamic';

const uuid = z.string().uuid();

/** Delete-sequence form action: posts a single `id`. */
async function deleteSequenceForm(formData: FormData): Promise<void> {
  'use server';
  const id = uuid.parse(formData.get('id'));
  await deleteSequence(id);
}

// --- Inline styles (Tailwind is not wired yet; mirror app/campaigns/page.tsx) -

const cellStyle: React.CSSProperties = {
  padding: '0.625rem 0.75rem',
  borderBottom: '1px solid #eee',
  textAlign: 'left',
  verticalAlign: 'top',
};

const headStyle: React.CSSProperties = {
  ...cellStyle,
  borderBottom: '2px solid #ddd',
  fontWeight: 600,
  color: '#555',
  fontSize: '0.8125rem',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};

const newSequenceLinkStyle: React.CSSProperties = {
  padding: '0.45rem 0.9rem',
  background: '#111',
  color: '#fff',
  textDecoration: 'none',
  borderRadius: 6,
  fontSize: '0.9rem',
  fontWeight: 500,
  whiteSpace: 'nowrap',
};

const rowLinkStyle: React.CSSProperties = {
  textDecoration: 'none',
  color: '#111',
  fontWeight: 500,
};

const deleteButtonStyle: React.CSSProperties = {
  padding: '0.3rem 0.6rem',
  background: '#fff',
  color: '#b91c1c',
  border: '1px solid #e5b4b4',
  borderRadius: 4,
  fontSize: '0.8125rem',
  cursor: 'pointer',
};

// --- Page --------------------------------------------------------------------

export default async function SequencesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const sequences = await listSequences();

  return (
    <main
      style={{
        padding: '2rem',
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 960,
        margin: '0 auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '1rem',
        }}
      >
        <div>
          <h1 style={{ marginBottom: '0.25rem' }}>Sequences</h1>
          <p style={{ marginTop: 0, color: '#666' }}>
            Reusable outreach cadences and their ordered steps.
          </p>
        </div>
        <Link href="/sequences/new" style={newSequenceLinkStyle}>
          New sequence
        </Link>
      </div>

      {sequences.length === 0 ? (
        <div
          style={{
            marginTop: '2rem',
            padding: '2rem',
            textAlign: 'center',
            color: '#666',
            background: '#fafafa',
            border: '1px solid #eee',
            borderRadius: 6,
          }}
        >
          <p style={{ margin: 0, fontSize: '1.05rem' }}>No sequences yet.</p>
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
            <Link href="/sequences/new">Create your first sequence</Link> to get started.
          </p>
        </div>
      ) : (
        <table
          style={{
            marginTop: '1.5rem',
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '0.9375rem',
          }}
        >
          <thead>
            <tr>
              <th style={headStyle} scope="col">
                Name
              </th>
              <th style={{ ...headStyle, textAlign: 'right', width: '1%' }} scope="col">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {sequences.map((sequence) => (
              <tr key={sequence.id}>
                <td style={cellStyle}>
                  <Link href={`/sequences/${sequence.id}`} style={rowLinkStyle}>
                    {sequence.name}
                  </Link>
                </td>
                <td style={{ ...cellStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <form action={deleteSequenceForm} style={{ display: 'inline' }}>
                    <input type="hidden" name="id" value={sequence.id} />
                    <button type="submit" style={deleteButtonStyle}>
                      Delete
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
