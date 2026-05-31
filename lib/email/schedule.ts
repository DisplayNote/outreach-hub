/**
 * Sequence cadence helpers (PHASE_5_SPEC §4). Pure — the caller passes the
 * anchor date (no `Date.now()` here), so scheduling is deterministic and
 * unit-testable.
 */
import type { SequenceStep } from '@/lib/types/domain';

const DAY_MS = 86_400_000;

/** Day-of-week for a `YYYY-MM-DD` date in UTC (0 = Sun … 6 = Sat). */
function dayOfWeek(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00.000Z`).getUTCDay();
}

/**
 * Add `n` calendar days to a `YYYY-MM-DD` date and return `YYYY-MM-DD`. When
 * `skipWeekends`, a landing on Sat/Sun rolls forward to the following Monday
 * (legacy weekend guard). `n` is treated as calendar days plus a final roll —
 * matching the legacy behaviour of scheduling N days out then nudging off the
 * weekend.
 */
export function businessDayAdd(isoDate: string, n: number, skipWeekends: boolean): string {
  const base = new Date(`${isoDate}T00:00:00.000Z`).getTime() + n * DAY_MS;
  let result = new Date(base).toISOString().slice(0, 10);
  if (skipWeekends) {
    const dow = dayOfWeek(result);
    if (dow === 6) result = new Date(base + 2 * DAY_MS).toISOString().slice(0, 10); // Sat → Mon
    else if (dow === 0) result = new Date(base + 1 * DAY_MS).toISOString().slice(0, 10); // Sun → Mon
  }
  return result;
}

/** The step a contact is currently on (its `day_offset` === `dayOffset`), or null. */
export function currentStep(steps: readonly SequenceStep[], dayOffset: number): SequenceStep | null {
  return steps.find((s) => s.dayOffset === dayOffset) ?? null;
}

/**
 * The next step after `dayOffset`: the one with the smallest `day_offset`
 * strictly greater than it, or null when the contact is on the last step.
 */
export function nextStep(steps: readonly SequenceStep[], dayOffset: number): SequenceStep | null {
  return (
    [...steps]
      .filter((s) => s.dayOffset > dayOffset)
      .sort((a, b) => a.dayOffset - b.dayOffset)[0] ?? null
  );
}
