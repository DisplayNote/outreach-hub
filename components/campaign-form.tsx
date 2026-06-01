'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Campaign } from '@/lib/types/domain';
import { Button, Field } from '@/components/ui';

/**
 * Shared create/edit form for a campaign. Renders the two editable columns
 * (`name`, `sequence`) and submits to a passed-in Server Action (`action`),
 * which parses the FormData, calls createCampaign/updateCampaign, and redirects
 * on success.
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
        <Field label="Sequence" htmlFor="sequence">
          <input
            id="sequence"
            name="sequence"
            type="text"
            defaultValue={value(campaign?.sequence)}
            className="input"
          />
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
