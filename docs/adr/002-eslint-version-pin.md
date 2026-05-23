# ADR 002 — Pin ESLint to `^9` for Phase 0+

- **Status:** Accepted (retroactive — implemented during Phase 0 bootstrap, commit `83b47dd`)
- **Date:** 2026-05-23

## Context

Phase 0 Task 3 installs `eslint`, `eslint-config-next`, and the
`@typescript-eslint` plugins. With unpinned versions, pnpm pulled:

- `eslint@10.4.0`
- `eslint-config-next@16.2.6` (which transitively pulls `eslint-plugin-react@7.37.5`)

On the first `pnpm lint` run, ESLint failed with:

```
TypeError: Error while loading rule 'react/display-name':
  contextOrFilename.getFilename is not a function
```

The cause is an API break in ESLint 10's rule-context shape that
`eslint-plugin-react@7.37.5` has not yet adopted. `eslint-config-next@16`
declares peer dependency `eslint: ">=9.0.0"` but does not cap the upper
bound, so the conflict slipped through `pnpm install`.

This is upstream's responsibility to fix — but waiting for a coordinated
release of `eslint-config-next` + `eslint-plugin-react` against ESLint 10
would block Phase 0 indefinitely.

## Decision

Pin `eslint` to `^9` in `devDependencies`:

```jsonc
"eslint": "^9.0.0"
```

`pnpm-lock.yaml` resolves this to `eslint@9.39.4` at time of writing.
`pnpm lint` now exits 0 (with two warnings about anonymous default exports
in config files, which are stylistic and explicitly tolerated by §5.6).

## Consequences

- The lint stack remains a major version behind ESLint upstream. We accept
  this until either:
  - `eslint-plugin-react` ships a fix for the rule-context API, **or**
  - `eslint-config-next` bumps its `eslint-plugin-react` minimum.
- A scheduled dependency review (Phase 7 work) will revisit this pin.
- Anyone bumping `eslint` past 9.x must first verify `pnpm lint` still runs
  clean.

## Alternatives considered

- **Use eslint-config-next 15.x** (Next 15 series), which targets an older
  plugin set. Rejected because the deprecation of `next lint` in Next 15.5
  pushed us to flat config anyway, and 16.x's flat exports (`next/flat/…`)
  are cleaner than the `FlatCompat` shim. Pinning ESLint is a smaller blast
  radius than pinning two of the config's transitive deps.
- **Override the transitive `eslint-plugin-react` via pnpm overrides.**
  Rejected: would require tracking a fork-or-newer-than-current version with
  unknown compatibility against the rest of `eslint-config-next 16`.
- **Disable the failing rule.** Rejected: the error happens at rule-loading
  time, not when the rule runs, so disabling the rule does not bypass the
  crash.

## References

- ESLint 10 release notes: <https://eslint.org/blog/2025/>
- eslint-plugin-react issue tracker (search "contextOrFilename" /
  "getFilename") for upstream tracking.
