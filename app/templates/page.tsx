import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { listTemplates } from '@/lib/supabase/queries';
import { deleteTemplate } from '@/lib/actions/templates';
import type { Template } from '@/lib/types/domain';

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

// --- Inline styles (Tailwind is not wired yet; mirror app/today/page.tsx) ----

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

const newTemplateLinkStyle: React.CSSProperties = {
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

const editLinkStyle: React.CSSProperties = {
  textDecoration: 'none',
  color: '#2563eb',
  fontSize: '0.875rem',
};

const deleteButtonStyle: React.CSSProperties = {
  padding: 0,
  background: 'none',
  border: 0,
  color: '#b91c1c',
  fontSize: '0.875rem',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

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
          <h1 style={{ marginBottom: '0.25rem' }}>Templates</h1>
          <p style={{ marginTop: 0, color: '#666' }}>
            Reusable email templates for your organisation&rsquo;s outreach.
          </p>
        </div>
        <Link href="/templates/new" style={newTemplateLinkStyle}>
          New template
        </Link>
      </div>

      {templates.length === 0 ? (
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
          <p style={{ margin: 0, fontSize: '1.05rem' }}>No templates yet.</p>
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
            <Link href="/templates/new">Create your first template</Link> to get started.
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
              <th style={headStyle} scope="col">
                Subject
              </th>
              <th style={headStyle} scope="col">
                Updated
              </th>
              <th style={headStyle} scope="col">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {templates.map((template) => (
              <tr key={template.id}>
                <td style={cellStyle}>
                  <Link href={`/templates/${template.id}/edit`} style={rowLinkStyle}>
                    {template.name}
                  </Link>
                  {template.body ? (
                    <span style={{ display: 'block', color: '#888', fontSize: '0.8125rem' }}>
                      {preview(template.body)}
                    </span>
                  ) : null}
                </td>
                <td style={cellStyle}>
                  {template.subject ?? <span style={{ color: '#aaa' }}>—</span>}
                </td>
                <td style={cellStyle}>{formatTimestamp(template.updatedAt)}</td>
                <td style={cellStyle}>
                  <span style={{ display: 'inline-flex', gap: '0.75rem', alignItems: 'center' }}>
                    <Link href={`/templates/${template.id}/edit`} style={editLinkStyle}>
                      Edit
                    </Link>
                    <form action={deleteAction} style={{ display: 'inline' }}>
                      <input type="hidden" name="id" value={template.id} />
                      <button type="submit" style={deleteButtonStyle}>
                        Delete
                      </button>
                    </form>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
