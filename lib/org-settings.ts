/**
 * Merge a validated settings patch into the existing org settings using
 * read-merge-write semantics.
 *
 * A key whose value is `undefined` means "leave the stored value unchanged":
 * the Settings page builds a patch like `{ dailyGoal: undefined }` for any
 * blank input, and `zod`'s object parse PRESERVES those keys (value `undefined`)
 * rather than dropping them. A naive `{ ...existing, ...patch }` spread would
 * therefore overwrite stored values with `undefined`, which JSON serialisation
 * then drops entirely — silently deleting settings the user merely left blank.
 * Skipping `undefined` values here makes a blank field a true no-op.
 */
export function mergeOrgSettingsPatch(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  // Null-prototype target: the patch comes from a `.passthrough()` schema, so a
  // caller-supplied `__proto__`/`constructor` key would otherwise pollute
  // Object.prototype via the assignment below. With no prototype, every key is
  // a plain data property.
  const merged: Record<string, unknown> = Object.assign(Object.create(null), existing);
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  return merged;
}
