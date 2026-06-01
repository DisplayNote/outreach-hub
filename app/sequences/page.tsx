import Link from 'next/link';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { listSequences } from '@/lib/supabase/queries';
import { deleteSequence } from '@/lib/actions/sequences';
import { Button, Card, EmptyState } from '@/components/ui';

// Auth state + the sequence list change per request; never prerender (ADR 004).
export const dynamic = 'force-dynamic';

const uuid = z.string().uuid();

/** Delete-sequence form action: posts a single `id`. */
async function deleteSequenceForm(formData: FormData): Promise<void> {
  'use server';
  const id = uuid.parse(formData.get('id'));
  await deleteSequence(id);
}

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
    <div className="content__inner">
      <div className="page-head">
        <div>
          <div className="page-head__title">Sequences</div>
          <div className="page-head__sub">Reusable outreach cadences and their ordered steps.</div>
        </div>
        <div className="page-actions">
          <Link href="/sequences/new" className="btn btn--primary">
            New sequence
          </Link>
        </div>
      </div>

      <Card title="All sequences" bodyStyle={{ padding: 0 }}>
        {sequences.length === 0 ? (
          <EmptyState
            icon="sequence"
            title="No sequences yet"
            desc="Create your first sequence to get started."
            action={
              <Link href="/sequences/new" className="btn btn--primary">
                New sequence
              </Link>
            }
          />
        ) : (
          <div className="tbl-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col" style={{ textAlign: 'right', width: '1%' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {sequences.map((sequence) => (
                  <tr key={sequence.id} className="row-link">
                    <td>
                      <Link href={`/sequences/${sequence.id}`} className="medb">
                        {sequence.name}
                      </Link>
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <form action={deleteSequenceForm} style={{ display: 'inline' }}>
                        <input type="hidden" name="id" value={sequence.id} />
                        <Button type="submit" variant="danger" size="sm">
                          Delete
                        </Button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
