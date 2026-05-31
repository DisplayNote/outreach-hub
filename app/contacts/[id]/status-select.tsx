'use client';

import { useRef } from 'react';
import type { ContactStatus } from '@/lib/types/domain';
import { setContactStatusForm } from '@/app/contacts/[id]/actions';

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
      <select
        name="status"
        defaultValue={current}
        onChange={() => formRef.current?.requestSubmit()}
        aria-label="Contact status"
        style={{
          padding: '0.4rem 0.6rem',
          fontSize: '0.9375rem',
          border: '1px solid #d1d5db',
          borderRadius: 4,
          background: 'white',
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <noscript>
        {' '}
        <button
          type="submit"
          style={{
            padding: '0.4rem 0.6rem',
            fontSize: '0.875rem',
            border: '1px solid #d1d5db',
            borderRadius: 4,
            background: '#f3f4f6',
            cursor: 'pointer',
          }}
        >
          Update
        </button>
      </noscript>
    </form>
  );
}
