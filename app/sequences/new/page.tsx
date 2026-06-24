import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { createSequence } from '@/lib/actions/sequences';
import { Button, Card, Field } from '@/components/ui';

// Auth state changes per request; never prerender (ADR 004).
export const dynamic = 'force-dynamic';

export default async function NewSequencePage() {
  const session = await getSession();
  if (!session) {
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
    <div className="content__inner">
      <div className="page-head">
        <div>
          <div className="page-head__title">New sequence</div>
          <div className="page-head__sub">Name a sequence, then add its ordered steps.</div>
        </div>
      </div>

      <Card>
        <form action={action}>
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <Field label="Name" htmlFor="name" required>
              <input id="name" name="name" type="text" required autoFocus className="input" />
            </Field>
          </div>

          <div className="row gap-4" style={{ marginTop: 'var(--space-7)' }}>
            <Button type="submit" variant="primary">
              Create sequence
            </Button>
            <Link href="/sequences" className="btn btn--ghost btn--md">
              Cancel
            </Link>
          </div>
        </form>
      </Card>
    </div>
  );
}
