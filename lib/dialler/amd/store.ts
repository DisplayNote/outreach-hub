/**
 * Supabase service-role adapter for {@link AmdStore}: maps applyEvent's narrow
 * write surface onto the `call_attempts` / `call_events` / `touchpoints` tables.
 * Bypasses RLS (service role), so every write carries `org_id` explicitly from
 * the attempt the caller loaded (DECISION 4.1). Kept separate from apply.ts so
 * the orchestration stays free of Supabase imports and unit-testable with a fake.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AmdStore, AttemptPatch } from '@/lib/dialler/amd/apply';

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
