'use client';

import { useRef } from 'react';
import type { ContactStatus } from '@/lib/types/domain';
import { setContactStatusForm } from '@/app/contacts/[id]/actions';
import { Button, Icon } from '@/components/ui';

interface StatusOption {
  value: ContactStatus;
  label: string;
}

/**
 * Inline status control. A `<select>` inside a server-action form that submits
 * itself the moment the value changes — no explicit "Save" button. Client
 * component purely because it needs an `onChange` handler; the mutation still
 * runs server-side via `setContactStatusForm`.
 */
export default function StatusSelect({
  contactId,
  current,
  options,
}: {
  contactId: string;
  current: ContactStatus;
  options: readonly StatusOption[];
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={setContactStatusForm}>
      <input type="hidden" name="id" value={contactId} />
      <div className="select-wrap">
        <select
          className="input"
          name="status"
          defaultValue={current}
          onChange={() => formRef.current?.requestSubmit()}
          aria-label="Contact status"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="select-chevron">
          <Icon name="chevronDown" size={15} />
        </span>
      </div>
      <noscript>
        {' '}
        <Button type="submit" variant="secondary" size="sm">
          Update
        </Button>
      </noscript>
    </form>
  );
}
