'use client';

import { useState } from 'react';
import type { Campaign, Contact, ContactStatus } from '@/lib/types/domain';
import { CONTACT_STATUSES } from '@/lib/types/domain';

/**
 * Shared create/edit form for a contact. Renders one control per editable
 * column and submits to a passed-in Server Action (`action`), which is
 * responsible for parsing the FormData, calling createContact/updateContact,
 * and redirecting on success.
 *
 * Client component: it owns a lightweight pending state for the submit button
 * so a double-click can't fire the action twice. Field names map 1:1 to the
 * camelCase keys the page-level action expects.
 *
 * Styling mirrors the inline-style approach used elsewhere (Tailwind is not
 * wired yet — see app/today/page.tsx).
 */

/** Human-readable label for each contact status, in schema order. */
const STATUS_LABELS: Record<ContactStatus, string> = {
  none: 'No status',
  amber: 'Amber',
  red: 'Red',
  green: 'Green',
  meeting: 'Meeting',
  notinterested: 'Not interested',
  bounced: 'Bounced',
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

const fieldGroupStyle: React.CSSProperties = {
  marginBottom: '1.1rem',
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '0 1.25rem',
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

export interface ContactFormProps {
  /** Server Action that receives the form's FormData and redirects on success. */
  action: (formData: FormData) => Promise<void>;
  /** Campaigns available for the campaign select (RLS-scoped to the org). */
  campaigns: readonly Campaign[];
  /** Existing contact to pre-fill (edit mode). Omit for create mode. */
  contact?: Contact;
  /** Label for the submit button, e.g. "Create contact" / "Save changes". */
  submitLabel: string;
  /** Where the Cancel link points. */
  cancelHref: string;
}

/** Coerce a nullable value to a string suitable for a controlled-ish input. */
function value(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

export default function ContactForm({
  action,
  campaigns,
  contact,
  submitLabel,
  cancelHref,
}: ContactFormProps) {
  const [pending, setPending] = useState(false);

  return (
    <form
      action={action}
      onSubmit={() => setPending(true)}
      style={{ fontFamily: 'system-ui, sans-serif' }}
    >
      <div style={fieldGroupStyle}>
        <label htmlFor="campaignId" style={labelStyle}>
          Campaign *
        </label>
        <select
          id="campaignId"
          name="campaignId"
          required
          defaultValue={contact?.campaignId ?? ''}
          style={fieldStyle}
        >
          <option value="" disabled>
            Select a campaign…
          </option>
          {campaigns.map((campaign) => (
            <option key={campaign.id} value={campaign.id}>
              {campaign.name}
            </option>
          ))}
        </select>
      </div>

      <div style={gridStyle}>
        <div style={fieldGroupStyle}>
          <label htmlFor="firstName" style={labelStyle}>
            First name
          </label>
          <input
            id="firstName"
            name="firstName"
            type="text"
            defaultValue={value(contact?.firstName)}
            style={fieldStyle}
          />
        </div>

        <div style={fieldGroupStyle}>
          <label htmlFor="lastName" style={labelStyle}>
            Last name
          </label>
          <input
            id="lastName"
            name="lastName"
            type="text"
            defaultValue={value(contact?.lastName)}
            style={fieldStyle}
          />
        </div>

        <div style={fieldGroupStyle}>
          <label htmlFor="email" style={labelStyle}>
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            defaultValue={value(contact?.email)}
            style={fieldStyle}
          />
        </div>

        <div style={fieldGroupStyle}>
          <label htmlFor="company" style={labelStyle}>
            Company
          </label>
          <input
            id="company"
            name="company"
            type="text"
            defaultValue={value(contact?.company)}
            style={fieldStyle}
          />
        </div>

        <div style={fieldGroupStyle}>
          <label htmlFor="phone" style={labelStyle}>
            Phone
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={value(contact?.phone)}
            style={fieldStyle}
          />
        </div>

        <div style={fieldGroupStyle}>
          <label htmlFor="mobile" style={labelStyle}>
            Mobile
          </label>
          <input
            id="mobile"
            name="mobile"
            type="tel"
            defaultValue={value(contact?.mobile)}
            style={fieldStyle}
          />
        </div>

        <div style={fieldGroupStyle}>
          <label htmlFor="jobTitle" style={labelStyle}>
            Job title
          </label>
          <input
            id="jobTitle"
            name="jobTitle"
            type="text"
            defaultValue={value(contact?.jobTitle)}
            style={fieldStyle}
          />
        </div>

        <div style={fieldGroupStyle}>
          <label htmlFor="seniority" style={labelStyle}>
            Seniority
          </label>
          <input
            id="seniority"
            name="seniority"
            type="text"
            defaultValue={value(contact?.seniority)}
            style={fieldStyle}
          />
        </div>

        <div style={fieldGroupStyle}>
          <label htmlFor="country" style={labelStyle}>
            Country
          </label>
          <input
            id="country"
            name="country"
            type="text"
            defaultValue={value(contact?.country)}
            style={fieldStyle}
          />
        </div>

        <div style={fieldGroupStyle}>
          <label htmlFor="linkedin" style={labelStyle}>
            LinkedIn
          </label>
          <input
            id="linkedin"
            name="linkedin"
            type="text"
            defaultValue={value(contact?.linkedin)}
            style={fieldStyle}
          />
        </div>

        <div style={fieldGroupStyle}>
          <label htmlFor="status" style={labelStyle}>
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={contact?.status ?? 'none'}
            style={fieldStyle}
          >
            {CONTACT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>

        <div style={fieldGroupStyle}>
          <label htmlFor="sequenceDay" style={labelStyle}>
            Sequence day
          </label>
          <input
            id="sequenceDay"
            name="sequenceDay"
            type="number"
            min={0}
            step={1}
            defaultValue={value(contact?.sequenceDay)}
            style={fieldStyle}
          />
        </div>

        <div style={fieldGroupStyle}>
          <label htmlFor="followUp" style={labelStyle}>
            Follow-up date
          </label>
          <input
            id="followUp"
            name="followUp"
            type="date"
            defaultValue={value(contact?.followUp)}
            style={fieldStyle}
          />
        </div>
      </div>

      <div style={fieldGroupStyle}>
        <label htmlFor="notes" style={labelStyle}>
          Notes
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={4}
          defaultValue={value(contact?.notes)}
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
