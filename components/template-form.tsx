'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Template } from '@/lib/types/domain';
import { Button, Field } from '@/components/ui';

/**
 * Shared create/edit form for an email template. Renders one control per
 * editable column (name, subject, body) and submits to a passed-in Server
 * Action (`action`), which is responsible for parsing the FormData, calling
 * createTemplate/updateTemplate, and redirecting on success.
 *
 * Client component: it owns a lightweight pending state for the submit button
 * so a double-click can't fire the action twice. Field names map 1:1 to the
 * camelCase keys the page-level action expects.
 *
 * Styling uses the shared design system (Field + .input classes, Button
 * primitive) — see components/campaign-form.tsx for established conventions.
 */

export interface TemplateFormProps {
  /** Server Action that receives the form's FormData and redirects on success. */
  action: (formData: FormData) => Promise<void>;
  /** Existing template to pre-fill (edit mode). Omit for create mode. */
  template?: Template;
  /** Label for the submit button, e.g. "Create template" / "Save changes". */
  submitLabel: string;
  /** Where the Cancel link points. */
  cancelHref: string;
}

/** Coerce a nullable value to a string suitable for a controlled-ish input. */
function value(v: string | null | undefined): string {
  if (v === null || v === undefined) return '';
  return v;
}

export default function TemplateForm({
  action,
  template,
  submitLabel,
  cancelHref,
}: TemplateFormProps) {
  const [pending, setPending] = useState(false);

  return (
    <form action={action} onSubmit={() => setPending(true)}>
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <Field label="Name" htmlFor="name" required>
          <input
            id="name"
            name="name"
            type="text"
            required
            defaultValue={value(template?.name)}
            className="input"
          />
        </Field>
      </div>

      <div style={{ marginBottom: 'var(--space-6)' }}>
        <Field label="Subject" htmlFor="subject">
          <input
            id="subject"
            name="subject"
            type="text"
            defaultValue={value(template?.subject)}
            className="input"
          />
        </Field>
      </div>

      <div style={{ marginBottom: 'var(--space-6)' }}>
        <Field
          label="Body"
          htmlFor="body"
          hint="Use {firstName}, {company} and other variables — they're rendered per contact when the email sends."
        >
          <textarea
            id="body"
            name="body"
            rows={12}
            defaultValue={value(template?.body)}
            className="input"
          />
        </Field>
      </div>

      <div className="row gap-4" style={{ marginTop: 'var(--space-7)' }}>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </Button>
        <Link href={cancelHref} className="btn btn--ghost">
          Cancel
        </Link>
      </div>
    </form>
  );
}
