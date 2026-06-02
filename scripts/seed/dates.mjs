// scripts/seed/dates.mjs
// Tiny pure date helpers for the dev seeder. Kept separate so dataset.mjs stays
// time-free (deterministic + unit-testable): the dataset stores integer day
// OFFSETS, and the seeder resolves them against a single `now` captured at run.

/** Return a new Date `days` after `base` (negative = before). */
export function addDays(base, days) {
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** `YYYY-MM-DD` (UTC) — for date columns like contacts.follow_up. */
export function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

/** Full ISO timestamp (UTC) — for timestamptz columns like occurred_at. */
export function isoAt(date) {
  return date.toISOString();
}
