'use server';

/**
 * Phase 2 write-layer Server Action for the click-to-call dialler.
 *
 * `logCallOutcome` is the single write the dialler produces when a call ends:
 * it appends a `phone` touchpoint to the contact's activity log and, when the
 * chosen outcome maps to a real pipeline status, advances the contact's status
 * in the same flow.
 *
 * Mirrors the conventions in `@/lib/actions/contacts.ts`: zod-validated inputs,
 * camelCase action shapes mapped to snake_case columns, mutations run through
 * the RLS-scoped server client, INSERTs carry `org_id` explicitly (via
 * `getCurrentOrgId`) so the RLS WITH CHECK passes, and every affected route is
 * revalidated after a successful mutation.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getCurrentOrgId } from '@/lib/supabase/org';
import type { Contact, Touchpoint } from '@/lib/types/domain';

// --- Outcome model ------------------------------------------------------------

/**
 * The eight call outcomes the dialler can record. Each maps to a default
 * touchpoint note and a `statusEffect`: a real `ContactStatus` advances the
 * contact, while `'none'` means "log only, leave status untouched".
 *
 * `statusEffect` is intentionally widened to include `'none'` (not a member of
 * `ContactStatus`) so the sentinel is expressible; the runtime guard below
 * narrows it back to a real status before any contact UPDATE.
 */
interface CallOutcomeDef {
  readonly label: string;
  readonly statusEffect: Contact['status'] | 'none';
  readonly defaultNote: string;
}

const CALL_OUTCOMES = {
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
} as const satisfies Record<string, CallOutcomeDef>;

export type CallOutcomeKey = keyof typeof CALL_OUTCOMES;

/** The outcome keys, for building the dialler UI's option list. */
export const CALL_OUTCOME_KEYS = Object.keys(CALL_OUTCOMES) as CallOutcomeKey[];

// --- Raw row shape (snake_case, exactly as returned by PostgREST) -------------

interface TouchpointRow {
  id: string;
  org_id: string;
  contact_id: string;
  channel: Touchpoint['channel'];
  note: string | null;
  occurred_at: string;
  legacy_id: string | null;
  created_at: string;
}

const TOUCHPOINT_SELECT =
  'id, org_id, contact_id, channel, note, occurred_at, legacy_id, created_at';

function toTouchpoint(row: TouchpointRow): Touchpoint {
  return {
    id: row.id,
    orgId: row.org_id,
    contactId: row.contact_id,
    channel: row.channel,
    note: row.note,
    occurredAt: row.occurred_at,
    legacyId: row.legacy_id,
    createdAt: row.created_at,
  };
}

// --- Revalidation -------------------------------------------------------------

/** Routes whose rendered output depends on the logged call. */
function revalidateDiallerRoutes(contactId: string): void {
  revalidatePath(`/contacts/${contactId}`);
  revalidatePath('/today');
  revalidatePath('/pipeline');
  revalidatePath('/dialler');
}

// --- Validation ---------------------------------------------------------------

const uuid = z.string().uuid();

const outcomeSchema = z.enum(
  CALL_OUTCOME_KEYS as unknown as [CallOutcomeKey, ...CallOutcomeKey[]],
);

// A trimmed, non-empty note or null. Empty input collapses to null so the
// outcome's default note is used instead (matches the contacts.ts convention).
const nullableNote = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .nullable();

const logCallOutcomeSchema = z.object({
  outcome: outcomeSchema,
  note: nullableNote.optional(),
});

export type LogCallOutcomeInput = z.input<typeof logCallOutcomeSchema>;

/** The shape returned to the caller: the logged touchpoint plus any status change. */
export interface CallOutcomeResult {
  touchpoint: Touchpoint;
  /** The new contact status, or null when the outcome left status untouched. */
  status: Contact['status'] | null;
}

// --- Action -------------------------------------------------------------------

export async function logCallOutcome(
  contactId: string,
  input: LogCallOutcomeInput,
): Promise<CallOutcomeResult> {
  const id = uuid.parse(contactId);
  const parsed = logCallOutcomeSchema.parse(input);
  const outcome = CALL_OUTCOMES[parsed.outcome];
  const orgId = await getCurrentOrgId();
  const supabase = await createClient();

  // 1. Append the phone touchpoint (occurred now), mirroring logTouchpoint.
  const touchpointRow: Record<string, unknown> = {
    org_id: orgId,
    contact_id: id,
    channel: 'phone',
    note: parsed.note ?? outcome.defaultNote,
    occurred_at: new Date().toISOString(),
  };

  const { data: tpData, error: tpError } = await supabase
    .from('touchpoints')
    .insert(touchpointRow)
    .select(TOUCHPOINT_SELECT)
    .single();

  if (tpError) {
    throw new Error(
      `logCallOutcome: failed to log touchpoint for contact ${id}: ${tpError.message}`,
    );
  }

  const touchpoint = toTouchpoint(tpData as TouchpointRow);

  // 2. Advance the contact's status when the outcome maps to a real status.
  let status: Contact['status'] | null = null;
  if (outcome.statusEffect !== 'none') {
    const nextStatus: Contact['status'] = outcome.statusEffect;
    const { error: statusError } = await supabase
      .from('contacts')
      .update({ status: nextStatus })
      .eq('id', id);

    if (statusError) {
      throw new Error(
        `logCallOutcome: failed to set status on contact ${id}: ${statusError.message}`,
      );
    }
    status = nextStatus;
  }

  revalidateDiallerRoutes(id);
  return { touchpoint, status };
}
