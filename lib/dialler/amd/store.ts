/**
 * Supabase service-role adapter for {@link AmdStore}: maps applyEvent's narrow
 * write surface onto the `call_attempts` / `call_events` / `touchpoints` tables.
 * Bypasses RLS (service role), so every write carries `org_id` explicitly from
 * the attempt the caller loaded (DECISION 4.1). Kept separate from apply.ts so
 * the orchestration stays free of Supabase imports and unit-testable with a fake.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AmdStore, AttemptPatch } from '@/lib/dialler/amd/apply';
import type { CallAttempt } from '@/lib/dialler/amd/types';

const ATTEMPT_SELECT =
  'id, org_id, run_id, contact_id, to_number, from_number, provider, call_control_id, state, amd_result, disposition, hangup_cause, error, started_at, ended_at, created_at, updated_at';

interface CallAttemptRow {
  id: string;
  org_id: string;
  run_id: string;
  contact_id: string;
  to_number: string;
  from_number: string | null;
  provider: string;
  call_control_id: string | null;
  state: CallAttempt['state'];
  amd_result: CallAttempt['amdResult'];
  disposition: CallAttempt['disposition'];
  hangup_cause: string | null;
  error: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

function toCallAttempt(row: CallAttemptRow): CallAttempt {
  return {
    id: row.id,
    orgId: row.org_id,
    runId: row.run_id,
    contactId: row.contact_id,
    toNumber: row.to_number,
    fromNumber: row.from_number,
    provider: row.provider,
    callControlId: row.call_control_id,
    state: row.state,
    amdResult: row.amd_result,
    disposition: row.disposition,
    hangupCause: row.hangup_cause,
    error: row.error,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Load the attempt a webhook/mock event belongs to, by its Telnyx call_control_id. */
export async function loadAttemptByCallControlId(
  client: SupabaseClient,
  callControlId: string,
): Promise<CallAttempt | null> {
  const { data, error } = await client
    .from('call_attempts')
    .select(ATTEMPT_SELECT)
    .eq('call_control_id', callControlId)
    .maybeSingle();
  if (error) throw new Error(`loadAttemptByCallControlId(${callControlId}): ${error.message}`);
  return data ? toCallAttempt(data as CallAttemptRow) : null;
}

/** Map the camelCase {@link AttemptPatch} to the snake_case `call_attempts` columns. */
function toAttemptRow(patch: AttemptPatch): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (patch.state !== undefined) row.state = patch.state;
  if (patch.amdResult !== undefined) row.amd_result = patch.amdResult;
  if (patch.disposition !== undefined) row.disposition = patch.disposition;
  if (patch.hangupCause !== undefined) row.hangup_cause = patch.hangupCause;
  if (patch.callControlId !== undefined) row.call_control_id = patch.callControlId;
  if (patch.startedAt !== undefined) row.started_at = patch.startedAt;
  if (patch.endedAt !== undefined) row.ended_at = patch.endedAt;
  return row;
}

export function supabaseAmdStore(client: SupabaseClient): AmdStore {
  return {
    async updateAttempt(id, patch) {
      const { error } = await client.from('call_attempts').update(toAttemptRow(patch)).eq('id', id);
      if (error) throw new Error(`updateAttempt(${id}): ${error.message}`);
    },
    async insertEvent(row) {
      const { error } = await client.from('call_events').insert({
        org_id: row.orgId,
        attempt_id: row.attemptId,
        event_type: row.eventType,
        payload: row.payload,
        occurred_at: row.occurredAt,
      });
      if (error) throw new Error(`insertEvent(${row.attemptId}): ${error.message}`);
    },
    async insertTouchpoint(row) {
      const { error } = await client.from('touchpoints').insert({
        org_id: row.orgId,
        contact_id: row.contactId,
        channel: 'phone',
        note: row.note,
        occurred_at: new Date().toISOString(),
      });
      if (error) throw new Error(`insertTouchpoint(${row.contactId}): ${error.message}`);
    },
  };
}
