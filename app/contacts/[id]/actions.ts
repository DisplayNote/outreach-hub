'use server';

/**
 * FormData adapters for the contact detail view's inline controls.
 *
 * The underlying domain actions in `@/lib/actions/contacts` take typed,
 * camelCase arguments. The detail page's status-change and log-touchpoint
 * forms post native FormData (no client JS required), so these thin wrappers
 * pull the fields out, validate the contact id, and delegate. Validation of
 * the payload itself (status enum, channel enum, note) lives in the domain
 * actions' zod schemas — we don't duplicate it here.
 */
import { z } from 'zod';
import { logTouchpoint, setContactStatus } from '@/lib/actions/contacts';
import type { ContactStatus, TouchpointChannel } from '@/lib/types/domain';

const uuid = z.string().uuid();

/** Status-change form action: posts `id` + `status`. */
export async function setContactStatusForm(formData: FormData): Promise<void> {
  const id = uuid.parse(formData.get('id'));
  const status = String(formData.get('status') ?? '') as ContactStatus;
  await setContactStatus(id, status);
}

/** Log-touchpoint form action: posts `id`, `channel`, and an optional `note`. */
export async function logTouchpointForm(formData: FormData): Promise<void> {
  const id = uuid.parse(formData.get('id'));
  const channel = String(formData.get('channel') ?? '') as TouchpointChannel;
  const note = String(formData.get('note') ?? '');
  await logTouchpoint(id, { channel, note });
}
