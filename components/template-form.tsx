'use client';

import { useState } from 'react';
import type { Template } from '@/lib/types/domain';

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
 * Styling mirrors the inline-style approach used elsewhere (Tailwind is not
 * wired yet — see components/contact-form.tsx, app/today/page.tsx).
 */

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

const fieldGroupStyle: React.CSSProperties = {
  marginBottom: '1.1rem',
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
    <form
      action={action}
      onSubmit={() => setPending(true)}
      style={{ fontFamily: 'system-ui, sans-serif' }}
    >
      <div style={fieldGroupStyle}>
        <label htmlFor="name" style={labelStyle}>
          Name *
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          defaultValue={value(template?.name)}
          style={fieldStyle}
        />
      </div>

      <div style={fieldGroupStyle}>
        <label htmlFor="subject" style={labelStyle}>
          Subject
        </label>
        <input
          id="subject"
          name="subject"
          type="text"
          defaultValue={value(template?.subject)}
          style={fieldStyle}
        />
      </div>

      <div style={fieldGroupStyle}>
        <label htmlFor="body" style={labelStyle}>
          Body
        </label>
        <textarea
          id="body"
          name="body"
          rows={12}
          defaultValue={value(template?.body)}
          style={{ ...fieldStyle, resize: 'vertical' }}
        />
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
        <button type="submit" disabled={pending} style={submitStyle}>
          {pending ? 'Saving…' : submitLabel}
        </button>
        <a href={cancelHref} style={cancelStyle}>
          Cancel
        </a>
      </div>
    </form>
  );
}
