import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { listTemplates } from '@/lib/supabase/queries';
import { deleteTemplate } from '@/lib/actions/templates';
import type { Template } from '@/lib/types/domain';
import { Button, Card, EmptyState, Icon } from '@/components/ui';

// Auth state + the template list change per request; never prerender (ADR 004).
export const dynamic = 'force-dynamic';

// --- Display helpers ---------------------------------------------------------

/** Format an ISO timestamp for the "updated" column. */
function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** A one-line preview of a template body, trimmed to a sensible length. */
function preview(body: string | null): string {
  if (!body) return '';
  const collapsed = body.replace(/\s+/g, ' ').trim();
  return collapsed.length > 80 ? `${collapsed.slice(0, 80)}…` : collapsed;
}

// --- Page --------------------------------------------------------------------

export default async function TemplatesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const templates: Template[] = await listTemplates();

  // Server Action bound to each row's delete form. Deletes by id (RLS scopes to
  // the org); deleteTemplate revalidates /templates so the list re-renders.
  async function deleteAction(formData: FormData): Promise<void> {
    'use server';
    const id = formData.get('id');
    if (typeof id === 'string' && id !== '') {
      await deleteTemplate(id);
    }
  }

  return (
    <div className="content__inner">
      <div className="page-head">
        <div>
          <div className="page-head__title">Templates</div>
          <div className="page-head__sub">
            Reusable email templates for your organisation&rsquo;s outreach.
          </div>
        </div>
        <div className="page-actions">
          <Link href="/templates/new" className="btn btn--primary btn--md">
            <Icon name="plus" size={16} />
            <span>New template</span>
          </Link>
        </div>
      </div>

      <Card title="All templates" bodyStyle={{ padding: 0 }}>
        {templates.length === 0 ? (
          <EmptyState
            icon="template"
            title="No templates yet"
            desc="Create your first template to get started."
            action={
              <Link href="/templates/new" className="btn btn--primary btn--md">
                <Icon name="plus" size={16} />
                <span>New template</span>
              </Link>
            }
          />
        ) : (
          <div className="tbl-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Subject</th>
                  <th scope="col">Updated</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {templates.map((template) => (
                  <tr key={template.id}>
                    <td>
                      <Link href={`/templates/${template.id}/edit`} className="medb">
                        {template.name}
                      </Link>
                      {template.body ? (
                        <div
                          className="cap tert"
                          style={{
                            maxWidth: 360,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {preview(template.body)}
                        </div>
                      ) : null}
                    </td>
                    <td className="sm">
                      {template.subject ?? <span className="tert">—</span>}
                    </td>
                    <td className="sm muted" style={{ whiteSpace: 'nowrap' }}>
                      {formatTimestamp(template.updatedAt)}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <span className="row gap-4 center" style={{ justifyContent: 'flex-end' }}>
                        <Link
                          href={`/templates/${template.id}/edit`}
                          className="btn btn--ghost btn--sm"
                        >
                          Edit
                        </Link>
                        <form action={deleteAction} style={{ display: 'inline' }}>
                          <input type="hidden" name="id" value={template.id} />
                          <Button type="submit" variant="danger" size="sm">
                            Delete
                          </Button>
                        </form>
                      </span>
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
