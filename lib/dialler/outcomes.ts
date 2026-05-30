/**
 * Canonical dialler outcome catalogue and status-precedence rules — the single
 * source of truth shared by the dialler UI (`getDiallerOutcomes`) and the
 * `logCallOutcome` Server Action. Driver-free and side-effect-free so it can be
 * imported from both client components and server actions, and unit-tested
 * directly.
 *
 * `statusEffect` of `'none'` means "log the call but leave the contact's status
 * untouched" (it is also a real `ContactStatus`, but no outcome ever writes the
 * literal `'none'` status — see {@link resolveStatusEffect}).
 */
import type { CallOutcome, CallOutcomeKey } from '@/lib/dialler/types';
import type { ContactStatus } from '@/lib/types/domain';

const CATALOGUE: Readonly<Record<CallOutcomeKey, Omit<CallOutcome, 'key'>>> = {
  connected: {
    label: 'Connected — had conversation',
    statusEffect: 'green',
    defaultNote: 'Call connected',
  },
  'callback-requested': {
    label: 'Callback requested',
    statusEffect: 'green',
    defaultNote: 'Callback requested',
  },
  'meeting-booked': {
    label: 'Meeting booked',
    statusEffect: 'meeting',
    defaultNote: 'Meeting booked',
  },
  'left-voicemail': {
    label: 'Left voicemail',
    statusEffect: 'none',
    defaultNote: 'Voicemail reached',
  },
  'no-answer': {
    label: 'No answer',
    statusEffect: 'none',
    defaultNote: 'No answer',
  },
  gatekeeper: {
    label: 'Gatekeeper / wrong person',
    statusEffect: 'none',
    defaultNote: 'Reached gatekeeper',
  },
  'not-interested': {
    label: 'Not interested',
    statusEffect: 'notinterested',
    defaultNote: 'Not interested',
  },
  'wrong-number': {
    label: 'Wrong number',
    statusEffect: 'bounced',
    defaultNote: 'Wrong number',
  },
};

/** Outcome keys in display order. */
export const CALL_OUTCOME_KEYS = Object.keys(CATALOGUE) as CallOutcomeKey[];

/** The catalogue entry for one outcome (label / statusEffect / defaultNote). */
export function getOutcomeDef(key: CallOutcomeKey): Omit<CallOutcome, 'key'> {
  return CATALOGUE[key];
}

/**
 * The full catalogue as a fresh array, so callers can sort/filter without
 * mutating shared state.
 */
export function getDiallerOutcomes(): CallOutcome[] {
  return CALL_OUTCOME_KEYS.map((key) => ({ key, ...CATALOGUE[key] }));
}

/** Terminal states a `green` outcome must never downgrade (spec §3 DECISION 3). */
const STRONGER_THAN_GREEN: ReadonlySet<ContactStatus> = new Set([
  'meeting',
  'notinterested',
  'bounced',
]);

/**
 * The status to write given the contact's CURRENT status and an outcome's
 * `statusEffect`, or `null` to leave the status unchanged. Rules:
 * - `'none'` effect → no change (log-only outcome).
 * - effect already equals the current status → no change (avoid a no-op write).
 * - `'green'` never downgrades a stronger terminal state
 *   (`meeting`/`notinterested`/`bounced`).
 * - explicit terminal effects (`meeting`/`notinterested`/`bounced`) always apply.
 */
export function resolveStatusEffect(
  current: ContactStatus,
  statusEffect: ContactStatus,
): ContactStatus | null {
  if (statusEffect === 'none') return null;
  if (statusEffect === current) return null;
  if (statusEffect === 'green' && STRONGER_THAN_GREEN.has(current)) return null;
  return statusEffect;
}

/** Outcomes that schedule a follow-up for the next day (so they resurface in Today). */
export function outcomeSchedulesCallback(key: CallOutcomeKey): boolean {
  return key === 'callback-requested';
}
