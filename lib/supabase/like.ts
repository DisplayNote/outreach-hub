/**
 * Escape Postgres LIKE/ILIKE metacharacters (`\`, `%`, `_`) so a value matches
 * literally. PostgREST's `ilike` filter treats its argument as a pattern; an
 * unescaped `%`/`_` in user data (e.g. an email address) would behave as a
 * wildcard and could match — and then mutate — the wrong row. Backslash is
 * Postgres' default LIKE escape character, so escaping these three keeps the
 * filter to case-insensitive equality.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
