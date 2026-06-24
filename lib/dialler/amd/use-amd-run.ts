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
 * The map is cleared on `runId` change / unmount, and no state is written after
 * unmount (the unmount-safety the realtime version carried).
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

export function useAmdRun(runId: string | null): UseAmdRunResult {
  const [attempts, setAttempts] = useState<Record<string, CallAttempt>>({});

  useEffect(() => {
    if (!runId) return;

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
      // Clear on teardown (runId change / unmount) so a new / non-null run never
      // shows the previous run's attempts. Done in cleanup, not the effect body,
      // to avoid a synchronous setState-in-effect.
      setAttempts({});
    };
  }, [runId]);

  return { attempts };
}
