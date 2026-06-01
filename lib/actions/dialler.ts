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
import {
  CALL_OUTCOME_KEYS,
  getOutcomeDef,
  outcomeSchedulesCallback,
  resolveStatusEffect,
} from '@/lib/dialler/outcomes';
import type { CallOutcomeKey } from '@/lib/dialler/types';
import type { Contact, Touchpoint } from '@/lib/types/domain';

// NOTE: a 'use server' module may ONLY export async functions. Do not add
// `export type { ... }` / value re-exports here — Turbopack does not erase a
// type-only re-export inside a 'use server' file and emits a runtime reference
// to the (non-existent) binding, crashing the route with a ReferenceError.
// Importers get CallOutcomeKey straight from '@/lib/dialler/types'.

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

/** Tomorrow as a YYYY-MM-DD string (UTC) for the contact's `follow_up` date column. */
function tomorrowDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
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
  const outcome = getOutcomeDef(parsed.outcome);
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

  // 2. Apply the contact-level effects in one UPDATE:
  //    - status, with precedence (never downgrade a stronger terminal state); and
  //    - a next-day follow-up for callback-requested, so it resurfaces in /today.
  let status: Contact['status'] | null = null;
  const contactUpdate: Record<string, unknown> = {};

  if (outcome.statusEffect !== 'none') {
    const { data: currentRow, error: readError } = await supabase
      .from('contacts')
      .select('status')
      .eq('id', id)
      .single();

    if (readError) {
      throw new Error(
        `logCallOutcome: failed to read contact ${id}: ${readError.message}`,
      );
    }

    const current = (currentRow as { status: Contact['status'] }).status;
    const next = resolveStatusEffect(current, outcome.statusEffect);
    if (next !== null) {
      contactUpdate.status = next;
      status = next;
    }
  }

  if (outcomeSchedulesCallback(parsed.outcome)) {
    contactUpdate.follow_up = tomorrowDate();
  }

  if (Object.keys(contactUpdate).length > 0) {
    const { error: updateError } = await supabase
      .from('contacts')
      .update(contactUpdate)
      .eq('id', id);

    if (updateError) {
      throw new Error(
        `logCallOutcome: failed to update contact ${id}: ${updateError.message}`,
      );
    }
  }

  revalidateDiallerRoutes(id);
  return { touchpoint, status };
}
