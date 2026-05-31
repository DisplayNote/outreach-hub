import { notFound, redirect } from 'next/navigation';
import TemplateForm from '@/components/template-form';
import { updateTemplate } from '@/lib/actions/templates';
import type { UpdateTemplateInput } from '@/lib/actions/templates';
import { createClient } from '@/lib/supabase/server';
import { getTemplate } from '@/lib/supabase/queries';

// Auth state + template data change per request; never prerender.
export const dynamic = 'force-dynamic';

// --- FormData parsing ---------------------------------------------------------

/** Trim a form field; collapse empty/missing to null so the column stays clean. */
function text(formData: FormData, key: string): string | null {
  const raw = formData.get(key);
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

const mainStyle: React.CSSProperties = {
  padding: '2rem',
  fontFamily: 'system-ui, sans-serif',
  maxWidth: 720,
  margin: '0 auto',
};

export default async function EditTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const template = await getTemplate(id);
  if (!template) {
    // RLS returns no row for unknown ids or other orgs — render a 404.
    notFound();
  }

  // Server Action bound to the form. Parses the submitted FormData into the
  // typed UpdateTemplateInput, updates by id (RLS scopes to the org), then
  // redirects back to the templates list.
  async function action(formData: FormData): Promise<void> {
    'use server';

    const input: UpdateTemplateInput = {
      name: String(formData.get('name') ?? ''),
      subject: text(formData, 'subject'),
      body: text(formData, 'body'),
    };

    await updateTemplate(id, input);
    redirect('/templates');
  }

  return (
    <main style={mainStyle}>
      <h1 style={{ marginBottom: '0.25rem' }}>Edit template</h1>
      <p style={{ marginTop: 0, marginBottom: '1.5rem', color: '#666' }}>
        Update this template&rsquo;s content.
      </p>
      <TemplateForm
        action={action}
        template={template}
        submitLabel="Save changes"
        cancelHref="/templates"
      />
    </main>
  );
}
