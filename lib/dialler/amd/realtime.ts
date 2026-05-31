'use client';

/**
 * Client hook that streams a run's `call_attempts` over Supabase Realtime
 * (PHASE_4_SPEC §8). On mount it fetches the run's current attempts, then
 * subscribes to `postgres_changes` filtered to `run_id`, applying every
 * insert/update into a keyed map. RLS (the SELECT policy) scopes both the
 * initial read and the stream to the caller's org, so no extra auth is needed.
 *
 * Unsubscribes on unmount / runId change to avoid leaking channels (mirrors the
 * unmount-safety the Phase-3 click-to-call learned the hard way).
 */
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CALL_ATTEMPT_SELECT, toCallAttempt, type CallAttemptRow } from '@/lib/dialler/amd/row';
import type { CallAttempt } from '@/lib/dialler/amd/types';

export interface UseAmdRunResult {
  /** Live attempts for the run, keyed by attempt id. */
  attempts: Record<string, CallAttempt>;
}

export function useAmdRun(runId: string | null): UseAmdRunResult {
  const [attempts, setAttempts] = useState<Record<string, CallAttempt>>({});

  useEffect(() => {
    if (!runId) return;

    let active = true;
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;

    void (async () => {
      // postgres_changes is RLS-filtered: without the user's token the realtime
      // connection is anon and the org-scoped SELECT policy drops every change.
      // Set the session token before subscribing so the run's rows come through.
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (token) supabase.realtime.setAuth(token);

      const { data } = await supabase
        .from('call_attempts')
        .select(CALL_ATTEMPT_SELECT)
        .eq('run_id', runId);
      if (active && data) {
        const next: Record<string, CallAttempt> = {};
        for (const row of data as CallAttemptRow[]) next[row.id] = toCallAttempt(row);
        setAttempts(next);
      }

      if (!active) return;
      channel = supabase
        .channel(`amd-run-${runId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'call_attempts', filter: `run_id=eq.${runId}` },
          (payload) => {
            const row = payload.new as CallAttemptRow | null;
            if (!row?.id) return;
            setAttempts((prev) => ({ ...prev, [row.id]: toCallAttempt(row) }));
          },
        )
        .subscribe();
    })();

    return () => {
      active = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [runId]);

  return { attempts };
}
