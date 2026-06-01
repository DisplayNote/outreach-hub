import type { ContactStatus } from '@/lib/types/domain';
import type { PillSpec } from '@/components/ui/pill';

export const STATUS_PILLS: Record<ContactStatus, PillSpec> = {
  none: { label: 'No status', fg: 'var(--neutral-600)', bg: 'var(--neutral-100)', dot: 'var(--neutral-400)' },
  amber: { label: 'Warming', fg: 'var(--amber-700)', bg: 'var(--amber-50)', dot: 'var(--amber-500)' },
  red: { label: 'Cold', fg: 'var(--red-700)', bg: 'var(--red-50)', dot: 'var(--red-500)' },
  green: { label: 'Engaged', fg: 'var(--green-700)', bg: 'var(--green-50)', dot: 'var(--green-500)' },
  meeting: { label: 'Meeting booked', fg: 'var(--violet-700)', bg: 'var(--violet-50)', dot: 'var(--violet-500)' },
  notinterested: { label: 'Not interested', fg: 'var(--neutral-600)', bg: 'var(--neutral-100)', dot: 'var(--neutral-500)' },
  bounced: { label: 'Bounced', fg: 'var(--orange-700)', bg: 'var(--orange-50)', dot: 'var(--orange-500)' },
};

/**
 * Canonical human-readable status labels — the single source of truth shared by
 * the status pills (lists/detail) and the status `<select>` controls
 * (create/edit form, inline detail select) so a user never picks one label and
 * sees a different one elsewhere. Derived from {@link STATUS_PILLS}.
 */
export const STATUS_LABELS: Record<ContactStatus, string> = {
  none: STATUS_PILLS.none.label,
  amber: STATUS_PILLS.amber.label,
  red: STATUS_PILLS.red.label,
  green: STATUS_PILLS.green.label,
  meeting: STATUS_PILLS.meeting.label,
  notinterested: STATUS_PILLS.notinterested.label,
  bounced: STATUS_PILLS.bounced.label,
};
