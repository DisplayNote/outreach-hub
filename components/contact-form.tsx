'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Campaign, Contact, ContactStatus } from '@/lib/types/domain';
import { CONTACT_STATUSES } from '@/lib/types/domain';
import { Button, Field, Icon } from '@/components/ui';

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
 * Styling uses the shared design system (Field + .input/.select classes,
 * Button primitive) — see app/contacts/page.tsx for established conventions.
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
    <form action={action} onSubmit={() => setPending(true)}>
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <Field label="Campaign" htmlFor="campaignId" required>
          <div className="select-wrap">
            <select
              id="campaignId"
              name="campaignId"
              required
              defaultValue={contact?.campaignId ?? ''}
              className="input"
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
            <span className="select-chevron">
              <Icon name="chevronDown" size={15} />
            </span>
          </div>
        </Field>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 'var(--space-6)',
        }}
      >
        <Field label="First name" htmlFor="firstName">
          <input
            id="firstName"
            name="firstName"
            type="text"
            defaultValue={value(contact?.firstName)}
            className="input"
          />
        </Field>

        <Field label="Last name" htmlFor="lastName">
          <input
            id="lastName"
            name="lastName"
            type="text"
            defaultValue={value(contact?.lastName)}
            className="input"
          />
        </Field>

        <Field label="Email" htmlFor="email">
          <input
            id="email"
            name="email"
            type="email"
            defaultValue={value(contact?.email)}
            className="input"
          />
        </Field>

        <Field label="Company" htmlFor="company">
          <input
            id="company"
            name="company"
            type="text"
            defaultValue={value(contact?.company)}
            className="input"
          />
        </Field>

        <Field label="Phone" htmlFor="phone">
          <input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={value(contact?.phone)}
            className="input"
          />
        </Field>

        <Field label="Mobile" htmlFor="mobile">
          <input
            id="mobile"
            name="mobile"
            type="tel"
            defaultValue={value(contact?.mobile)}
            className="input"
          />
        </Field>

        <Field label="Job title" htmlFor="jobTitle">
          <input
            id="jobTitle"
            name="jobTitle"
            type="text"
            defaultValue={value(contact?.jobTitle)}
            className="input"
          />
        </Field>

        <Field label="Seniority" htmlFor="seniority">
          <input
            id="seniority"
            name="seniority"
            type="text"
            defaultValue={value(contact?.seniority)}
            className="input"
          />
        </Field>

        <Field label="Country" htmlFor="country">
          <input
            id="country"
            name="country"
            type="text"
            defaultValue={value(contact?.country)}
            className="input"
          />
        </Field>

        <Field label="LinkedIn" htmlFor="linkedin">
          <input
            id="linkedin"
            name="linkedin"
            type="text"
            defaultValue={value(contact?.linkedin)}
            className="input"
          />
        </Field>

        <Field label="Status" htmlFor="status">
          <div className="select-wrap">
            <select
              id="status"
              name="status"
              defaultValue={contact?.status ?? 'none'}
              className="input"
            >
              {CONTACT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
            <span className="select-chevron">
              <Icon name="chevronDown" size={15} />
            </span>
          </div>
        </Field>

        <Field label="Sequence day" htmlFor="sequenceDay">
          <input
            id="sequenceDay"
            name="sequenceDay"
            type="number"
            min={0}
            step={1}
            defaultValue={value(contact?.sequenceDay)}
            className="input"
          />
        </Field>

        <Field label="Follow-up date" htmlFor="followUp">
          <input
            id="followUp"
            name="followUp"
            type="date"
            defaultValue={value(contact?.followUp)}
            className="input"
          />
        </Field>
      </div>

      <div style={{ marginTop: 'var(--space-6)' }}>
        <Field label="Notes" htmlFor="notes">
          <textarea
            id="notes"
            name="notes"
            rows={4}
            defaultValue={value(contact?.notes)}
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
