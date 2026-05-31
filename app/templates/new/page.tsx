import { redirect } from 'next/navigation';
import TemplateForm from '@/components/template-form';
import { createTemplate } from '@/lib/actions/templates';
import type { CreateTemplateInput } from '@/lib/actions/templates';
import { createClient } from '@/lib/supabase/server';

// Auth state changes per request; never prerender.
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

export default async function NewTemplatePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Server Action bound to the form. Parses the submitted FormData into the
  // typed CreateTemplateInput, inserts (org_id is set inside createTemplate),
  // then redirects back to the templates list.
  async function action(formData: FormData): Promise<void> {
    'use server';

    const input: CreateTemplateInput = {
      name: String(formData.get('name') ?? ''),
      subject: text(formData, 'subject'),
      body: text(formData, 'body'),
    };

    await createTemplate(input);
    redirect('/templates');
  }

  return (
    <main style={mainStyle}>
      <h1 style={{ marginBottom: '0.25rem' }}>New template</h1>
      <p style={{ marginTop: 0, marginBottom: '1.5rem', color: '#666' }}>
        Create a reusable email template.
      </p>
      <TemplateForm action={action} submitLabel="Create template" cancelHref="/templates" />
    </main>
  );
}
