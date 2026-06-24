'use client';

/**
 * Client hook that tracks a run's `call_attempts` (PHASE_4_SPEC §8).
 *
 * Phase 5 replaced the Supabase Realtime subscription with polling: on a
 * non-null `runId` it calls the `getAmdRunAttempts` server action every
 * {@link POLL_INTERVAL_MS}, replacing the keyed map with the freshly-read
 * snapshot. RLS (in the action) scopes the read to the caller's org, so no
 * token plumbing is needed.
 *
 * Polling continues for the whole life of the run rather than stopping the
 * instant every *current* attempt is terminal: the run is driven one contact
 * at a time, so the consumer keeps placing new (non-terminal) attempts between
 * terminal ones, and the consumer's reconciliation only fires on an `attempts`
 * change — a permanent stop would deadlock the run. The hook instead stops when
 * the consumer tears it down: the run completing unmounts the component (or it
 * flips `runId`), which is the "run is done" signal in practice.
 *
 * Polling runs while `enabled` is true (default) and a `runId` is set. It does
 * NOT stop on "every *current* attempt is terminal" (mid-run that's normal and a
 * permanent stop would deadlock the run); instead the CONSUMER passes
 * `enabled=false` once the whole run is done, stopping the polling without
 * clearing the final snapshot the completion screen shows. The map is cleared
 * only on `runId` change / unmount (NOT when `enabled` toggles), and no state is
 * written after unmount (the unmount-safety the realtime version carried).
 */
import { useEffect, useState } from 'react';
import { getAmdRunAttempts } from '@/lib/actions/amd-status';
import type { CallAttempt } from '@/lib/dialler/amd/types';

/** Poll cadence while a run is live. */
export const POLL_INTERVAL_MS = 1500;

export interface UseAmdRunResult {
  /** Latest attempts for the run, keyed by attempt id. */
  attempts: Record<string, CallAttempt>;
}

export function useAmdRun(runId: string | null, enabled = true): UseAmdRunResult {
  const [attempts, setAttempts] = useState<Record<string, CallAttempt>>({});

  // Clear the map when the RUN changes (or on unmount) — keyed on runId ONLY, so
  // toggling `enabled` (the run completing) does not wipe the final snapshot the
  // completion screen still renders.
  useEffect(() => {
    return () => setAttempts({});
  }, [runId]);

  // Poll while there's a live run AND polling is enabled. When `enabled` flips
  // false (run done), this effect's cleanup cancels the timer WITHOUT clearing
  // the map, so polling stops but the last snapshot is retained.
  useEffect(() => {
    if (!runId || !enabled) return;

    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    const poll = () => {
      void (async () => {
        let rows: CallAttempt[];
        try {
          rows = await getAmdRunAttempts(runId);
        } catch {
          // Transient failure — keep what we have and retry on the next tick.
          if (active) schedule();
          return;
        }
        if (!active) return;
        const next: Record<string, CallAttempt> = {};
        for (const row of rows) next[row.id] = row;
        setAttempts(next);
        // Keep polling for the life of the run; teardown (runId change / unmount)
        // is the stop signal. See the file header for why we don't stop on
        // "all current attempts terminal".
        schedule();
      })();
    };

    poll();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      // NOTE: no setAttempts({}) here — clearing is the runId-only effect's job,
      // so stopping polling on run-completion (enabled→false) keeps the snapshot.
    };
  }, [runId, enabled]);

  return { attempts };
}
