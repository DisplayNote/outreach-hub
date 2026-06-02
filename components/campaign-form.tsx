'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Campaign } from '@/lib/types/domain';
import { Button, Field } from '@/components/ui';

/**
 * Shared create/edit form for a campaign. Renders the editable fields (`name`
 * and a `sequenceId` picker) and submits to a passed-in Server Action
 * (`action`), which parses the FormData, calls createCampaign/updateCampaign,
 * and redirects on success.
 *
 * The sequence is chosen from a dropdown of the org's existing sequences (not a
 * free-text box), so a campaign can only ever reference a sequence that exists.
 * The selected `sequence_id` is the load-bearing link the email runner follows.
 *
 * Client component: it owns a lightweight pending state for the submit button
 * so a double-click can't fire the action twice. Field names map 1:1 to the
 * camelCase keys the page-level action expects.
 *
 * Styling uses the shared design system (Field + .input classes, Button
 * primitive) — see components/contact-form.tsx for established conventions.
 */

export interface CampaignFormProps {
  /** Server Action that receives the form's FormData and redirects on success. */
  action: (formData: FormData) => Promise<void>;
  /** Existing campaign to pre-fill (edit mode). Omit for create mode. */
  campaign?: Campaign;
  /** The org's sequences, used to populate the sequence dropdown. */
  sequences: ReadonlyArray<{ id: string; name: string }>;
  /** Label for the submit button, e.g. "Create campaign" / "Save changes". */
  submitLabel: string;
  /** Where the Cancel link points. */
  cancelHref: string;
}

/** Coerce a nullable value to a string suitable for a defaulted input. */
function value(v: string | null | undefined): string {
  if (v === null || v === undefined) return '';
  return v;
}

export default function CampaignForm({
  action,
  campaign,
  sequences,
  submitLabel,
  cancelHref,
}: CampaignFormProps) {
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
            defaultValue={value(campaign?.name)}
            className="input"
          />
        </Field>
      </div>

      <div style={{ marginBottom: 'var(--space-6)' }}>
        <Field
          label="Sequence"
          htmlFor="sequenceId"
          hint="Contacts in this campaign are emailed using this sequence. Manage sequences under Sequences."
        >
          <select
            id="sequenceId"
            name="sequenceId"
            defaultValue={value(campaign?.sequenceId)}
            className="input"
          >
            <option value="">— No sequence —</option>
            {sequences.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="row gap-4" style={{ marginTop: 'var(--space-7)' }}>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </Button>
        <Link href={cancelHref} className="btn btn--ghost btn--md">
          Cancel
        </Link>
      </div>
    </form>
  );
}
