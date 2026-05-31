/**
 * Shared `call_attempts` row shape + mapper. Pure (no Supabase/Node imports), so
 * it is safe to use from both the server store (`store.ts`) and the client
 * Realtime hook (`realtime.ts`), keeping one snake_case→camelCase mapping.
 */
import type { CallAttempt } from '@/lib/dialler/amd/types';

export const CALL_ATTEMPT_SELECT =
  'id, org_id, run_id, contact_id, to_number, from_number, provider, call_control_id, state, amd_result, disposition, hangup_cause, error, started_at, ended_at, created_at, updated_at';

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
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
