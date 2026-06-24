/**
 * Wires the AMD runtime: the org-scoped store, the attempt loaders, the chosen
 * backend (mock vs real), and the {@link processEvent} closure that the webhook
 * route and the mock backend both drive. Resolving the backend + process
 * together here handles their mutual reference (the backend's actuations call
 * back into processEvent; processEvent's actuator is the backend).
 *
 * `getAmdBackend()` returns the mock only when {@link isDiallerMockEnabled}
 * (dev + flag + loopback); otherwise the real {@link TelnyxAmdBackend}, which
 * requires the Telnyx env to be set.
 *
 * Azure migration (Phase 3): the call-table I/O moved off the supabase-js
 * service-role client onto Drizzle. Every write carries `org_id` explicitly from
 * the attempt the caller loaded (DECISION 4.1) and runs inside
 * {@link withServiceRls} so the RLS GUCs scope it to that org — there is no
 * authenticated user session on the webhook path.
 */
import { and, eq, sql } from 'drizzle-orm';
import { getServerEnv, isDiallerMockEnabled } from '@/lib/env';
import { db } from '@/lib/db/client';
import { withServiceRls } from '@/lib/db/rls-service';
import { callAttempts, callEvents, touchpoints } from '@/lib/db/schema';
import type { AmdStore, AttemptPatch } from '@/lib/dialler/amd/apply';
import { toCallAttempt, type CallAttemptRow } from '@/lib/dialler/amd/row';
import { processEvent, type ProcessDeps } from '@/lib/dialler/amd/process';
import { MockTelnyxBackend } from '@/lib/dialler/amd/mock-backend';
import { TelnyxAmdBackend } from '@/lib/dialler/amd/telnyx-backend';
import { AmdBackendError, type CallAttempt, type TelnyxEvent } from '@/lib/dialler/amd/types';
import type { AmdDiallerBackend } from '@/lib/dialler/amd/backend';

export interface AmdRuntime {
  backend: AmdDiallerBackend;
  /** Feed an inbound event through load → apply → actuate. */
  process: (event: TelnyxEvent) => Promise<void>;
}

/**
 * Read one `call_attempts` row by `where`, scoped to its own org. The inbound
 * webhook carries no authenticated org, so this is the one service path that
 * must read across orgs to discover the attempt: it runs inside a transaction
 * with an unset `app.org_id` GUC and reads the row directly, then every
 * subsequent write derives `org_id` from the returned attempt. Returns the
 * mapped {@link CallAttempt}, or null when no row matches.
 */
async function loadAttempt(by: { callControlId?: string; id?: string }): Promise<CallAttempt | null> {
  // Cross-org discovery: the inbound webhook doesn't know the org yet, so an
  // org-scoped SELECT (current_org_id() is NULL with no GUC set) would match
  // nothing. The find_call_attempt SECURITY DEFINER function bypasses RLS for
  // this single read (returns the full call_attempts row); every subsequent
  // write derives org_id from it and runs org-scoped via withServiceRls.
  const result = await db.execute(
    sql`select * from public.find_call_attempt(${by.callControlId ?? null}, ${by.id ?? null})`,
  );
  const row = result.rows[0];
  return row ? toCallAttempt(row as unknown as CallAttemptRow) : null;
}

/** Load the attempt a webhook/mock event belongs to, by its Telnyx call_control_id. */
function loadAttemptByCallControlId(callControlId: string): Promise<CallAttempt | null> {
  return loadAttempt({ callControlId });
}

/** Load an attempt by its id — fallback correlation when call_control_id isn't persisted yet. */
function loadAttemptById(attemptId: string): Promise<CallAttempt | null> {
  return loadAttempt({ id: attemptId });
}

/** Map the camelCase {@link AttemptPatch} to the `call_attempts` column set Drizzle updates. */
function toAttemptColumns(patch: AttemptPatch): Partial<typeof callAttempts.$inferInsert> {
  const row: Partial<typeof callAttempts.$inferInsert> = {};
  if (patch.state !== undefined) row.state = patch.state;
  if (patch.amdResult !== undefined) row.amdResult = patch.amdResult;
  if (patch.disposition !== undefined) row.disposition = patch.disposition;
  if (patch.hangupCause !== undefined) row.hangupCause = patch.hangupCause;
  if (patch.callControlId !== undefined) row.callControlId = patch.callControlId;
  if (patch.startedAt !== undefined) row.startedAt = patch.startedAt;
  if (patch.endedAt !== undefined) row.endedAt = patch.endedAt;
  return row;
}

/**
 * Drizzle-backed {@link AmdStore}: maps applyEvent's narrow write surface onto
 * the `call_attempts` / `call_events` / `touchpoints` tables. Every write runs
 * inside {@link withServiceRls} keyed on the `org_id` the caller carries (from
 * the attempt it loaded), so RLS scopes the write to that org — the service
 * path has no authenticated user session.
 *
 * `attemptOrgIds` caches the org for an attempt id so `updateAttempt` /
 * `markActuated` (which receive only the attempt id) can be scoped to the same
 * org the attempt was loaded under. `processEvent` always loads the attempt
 * before any write, populating this cache first.
 */
function drizzleAmdStore(attemptOrgIds: Map<string, string>): AmdStore {
  const orgFor = (attemptId: string): string => {
    const orgId = attemptOrgIds.get(attemptId);
    if (orgId === undefined) {
      throw new Error(`AmdStore: org_id unknown for attempt ${attemptId} (attempt not loaded first)`);
    }
    return orgId;
  };

  return {
    async updateAttempt(id, patch) {
      const orgId = orgFor(id);
      const columns = toAttemptColumns(patch);
      if (Object.keys(columns).length === 0) return;
      // Touch updated_at to mirror the DB trigger's effect; scope by org so a
      // guessed id cannot cross-write another org's attempt (RLS also enforces).
      await withServiceRls(orgId, (tx) =>
        tx
          .update(callAttempts)
          .set({ ...columns, updatedAt: sql`now()` })
          .where(and(eq(callAttempts.id, id), eq(callAttempts.orgId, orgId))),
      );
    },
    async insertEvent(row) {
      await withServiceRls(row.orgId, (tx) =>
        tx.insert(callEvents).values({
          orgId: row.orgId,
          attemptId: row.attemptId,
          eventType: row.eventType,
          payload: row.payload,
          occurredAt: row.occurredAt,
        }),
      );
    },
    async insertTouchpoint(row) {
      // Idempotent on (org_id, legacy_id): a retried webhook re-runs this insert
      // safely without creating a duplicate touchpoint.
      await withServiceRls(row.orgId, (tx) =>
        tx
          .insert(touchpoints)
          .values({
            orgId: row.orgId,
            contactId: row.contactId,
            channel: 'phone',
            note: row.note,
            occurredAt: row.occurredAt,
            legacyId: row.legacyId,
          })
          .onConflictDoNothing({ target: [touchpoints.orgId, touchpoints.legacyId] }),
      );
    },
    async markActuated(attemptId, occurredAt) {
      const orgId = orgFor(attemptId);
      await withServiceRls(orgId, (tx) =>
        tx
          .update(callAttempts)
          .set({ actuatedAt: occurredAt, updatedAt: sql`now()` })
          .where(and(eq(callAttempts.id, attemptId), eq(callAttempts.orgId, orgId))),
      );
    },
  };
}

export function createAmdRuntime(): AmdRuntime {
  const env = getServerEnv();

  // Maps an attempt id → its org, populated when an attempt is loaded so the
  // id-only writes (updateAttempt / markActuated) can be org-scoped. Lives for
  // the lifetime of this runtime instance (one webhook request / one mock call).
  const attemptOrgIds = new Map<string, string>();
  const remember = (attempt: CallAttempt | null): CallAttempt | null => {
    if (attempt) attemptOrgIds.set(attempt.id, attempt.orgId);
    return attempt;
  };

  const store = drizzleAmdStore(attemptOrgIds);

  // `backend` is assigned just below; the actuator closure reads it lazily at
  // call time, so the mutual reference is safe.
  let backend: AmdDiallerBackend;

  const deps: ProcessDeps = {
    store,
    loadAttempt: (callControlId) => loadAttemptByCallControlId(callControlId).then(remember),
    loadAttemptById: (attemptId) => loadAttemptById(attemptId).then(remember),
    actuator: {
      hangup: (id) => backend.hangup(id),
      bridge: (id, target) => backend.bridge(id, target),
    },
    now: () => new Date().toISOString(),
    bridgeTarget: env.BRIDGE_SIP_USERNAME ? `sip:${env.BRIDGE_SIP_USERNAME}@sip.telnyx.com` : '',
  };

  const process = (event: TelnyxEvent): Promise<void> => processEvent(deps, event).then(() => undefined);

  if (isDiallerMockEnabled()) {
    backend = new MockTelnyxBackend({ process });
  } else {
    if (!env.TELNYX_API_KEY || !env.TELNYX_CONNECTION_ID || !env.BRIDGE_SIP_USERNAME || !env.TELNYX_PUBLIC_KEY) {
      // All four are required for a working real backend:
      // - BRIDGE_SIP_USERNAME: a human AMD result transfers to this SIP target;
      //   an empty target always fails (stuck attempt / Telnyx retries).
      // - TELNYX_PUBLIC_KEY: without it the webhook route rejects every inbound
      //   event (401), so calls are placed but never progress and can leak.
      throw new AmdBackendError(
        'Telnyx backend requires TELNYX_API_KEY, TELNYX_CONNECTION_ID, BRIDGE_SIP_USERNAME and TELNYX_PUBLIC_KEY',
        undefined,
        'TELNYX_CONFIG',
      );
    }
    backend = new TelnyxAmdBackend({
      apiKey: env.TELNYX_API_KEY,
      connectionId: env.TELNYX_CONNECTION_ID,
      amdMode: env.AMD_MODE,
      noAnswerMs: env.NO_ANSWER_TIMEOUT_MS,
    });
  }

  return { backend, process };
}
