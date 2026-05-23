# ADR 003 — Workarounds for TypeScript 6 + `exactOptionalPropertyTypes`

- **Status:** Accepted (retroactive — implemented during Phase 0 bootstrap, commit `83b47dd`)
- **Date:** 2026-05-23

## Context

Spec §7.1 mandates `strict: true`, `noUncheckedIndexedAccess: true`, and
`exactOptionalPropertyTypes: true`. With TypeScript 6.0 these settings catch
real bugs but also surface friction in third-party type definitions and in
Next.js's bundler conventions. Phase 0 hit three concrete cases:

1. **CSS side-effect imports** (`import './globals.css'` in `app/layout.tsx`)
   raise `TS2882: Cannot find module or type declarations for side-effect
   import`. The Next.js TypeScript plugin makes these work in the language
   service, but `tsc --noEmit` doesn't see the plugin's contribution.

2. **`next-env.d.ts` is regenerated** by `next dev` and `next build` on every
   invocation. Any ambient declarations added there are silently stripped,
   so the natural "fix" — append `declare module '*.css';` — does not stick.

3. **Playwright's `defineConfig`** under `exactOptionalPropertyTypes` rejects
   `workers: number | undefined`. Their type says `workers?: string | number`,
   which prohibits an explicit `undefined`. The idiomatic
   `workers: process.env.CI ? 1 : undefined` therefore fails typecheck.

4. **`Error.cause` parameter property** inside the `EmailDriverError` class
   raised `TS4115`: parameter property must have `override` because it
   overrides `Error.cause`. The parameter-property + `noImplicitOverride`
   combination is rejected by TS 6.

These are not signs that the strict settings are wrong — they're the early
friction of catching things that older TS versions let through.

## Decision

Keep all four strict settings on and apply small, local fixes:

- **CSS imports:** ambient-declare `*.css` (plus a few useful siblings) in a
  separate file the build pipeline does not touch:

  ```ts
  // global.d.ts (NOT next-env.d.ts)
  declare module '*.css';
  declare module '*.css?inline';
  declare module '*.scss';
  declare module '*.svg' {
    const content: string;
    export default content;
  }
  ```

- **`next-env.d.ts`:** leave alone. The file warns *"This file should not be
  edited"* at the top. Anything we want to persist goes in `global.d.ts`.

- **Playwright `workers`:** conditionally spread the property instead of
  assigning `undefined`:

  ```ts
  ...(process.env.CI ? { workers: 1 } : {}),
  ```

- **`EmailDriverError.cause`:** drop parameter-property syntax for that field
  and forward the value to `Error`'s native `cause` option:

  ```ts
  constructor(message: string, cause?: unknown, code?: string) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'EmailDriverError';
    if (code !== undefined) this.code = code;
  }
  ```

- **`tsconfig.json`:** dropped the deprecated `baseUrl` line (TS 6 warns on
  it; `paths` still resolves relative to the tsconfig location).

## Consequences

- The settings catch real defects (e.g. unhandled optional access from
  `noUncheckedIndexedAccess`); we keep that benefit.
- Future contributors must use `global.d.ts` (or a similar file outside of
  `next-env.d.ts`) for ambient declarations.
- The Playwright config gets slightly less ergonomic — but only there.
- Any new error class extending `Error` should follow the `EmailDriverError`
  pattern and avoid parameter-property syntax for the `cause` field.

## Alternatives considered

- **Disable `exactOptionalPropertyTypes`.** Rejected: spec §7.1 mandates it,
  and the strictness has already paid for itself in catching API misuse.
- **Set `ignoreDeprecations: "6.0"` for `baseUrl`.** Rejected as needless
  noise — removing `baseUrl` works.
- **Ship `next-env.d.ts` with our extra declarations and add a pre-build
  step that re-applies them.** Rejected: brittle, and `global.d.ts` is just
  as effective.
