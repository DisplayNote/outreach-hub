/**
 * Shared `call_attempts` row shapes + mappers.
 *
 * `CallAttemptRow` / `toCallAttempt` are the snake_case projection the runtime's
 * hand-written Drizzle `select({...})` produces (it aliases columns to the
 * Postgres names); `CallAttemptDrizzleRow` / `drizzleRowToCallAttempt` cover a
 * plain `select()` of the table, which Drizzle already deserialises to
 * camelCase. Both land on the one `CallAttempt` domain shape. Pure (no
 * Supabase/Node imports) so any layer can use them.
 */
import type { InferSelectModel } from 'drizzle-orm';
import type { callAttempts } from '@/lib/db/schema';
import type { AmdResult, CallAttempt, CallDisposition } from '@/lib/dialler/amd/types';

export interface CallAttemptRow {
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
  actuated_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

export function toCallAttempt(row: CallAttemptRow): CallAttempt {
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
    actuatedAt: row.actuated_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Drizzle `call_attempts` row. The schema already deserialises columns to
 * camelCase (and timestamps as ISO strings via `mode: 'string'`), so this is a
 * near-identity shim — its job is the narrowing of the two `text` columns
 * (`amdResult` / `disposition`) the schema can only type as `string | null`
 * back to their domain unions. The DB constraints guarantee the values.
 */
export type CallAttemptDrizzleRow = InferSelectModel<typeof callAttempts>;

export function drizzleRowToCallAttempt(row: CallAttemptDrizzleRow): CallAttempt {
  return {
    id: row.id,
    orgId: row.orgId,
    runId: row.runId,
    contactId: row.contactId,
    toNumber: row.toNumber,
    fromNumber: row.fromNumber,
    provider: row.provider,
    callControlId: row.callControlId,
    state: row.state,
    amdResult: row.amdResult as AmdResult | null,
    disposition: row.disposition as CallDisposition | null,
    hangupCause: row.hangupCause,
    error: row.error,
    actuatedAt: row.actuatedAt,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
