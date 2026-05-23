# ADR 001 — pnpm `allowBuilds` lives in `pnpm-workspace.yaml`, not `package.json`

- **Status:** Accepted (retroactive — implemented during Phase 0 bootstrap, commit `83b47dd`)
- **Date:** 2026-05-23

## Context

pnpm 11 (we shipped on 11.2.2) blocks any package whose `postinstall` or
`install` script needs to run unless it has been explicitly approved by the
operator. On the first dependency install of Phase 0, two packages were
flagged:

- `sharp` (Next.js's image pipeline transitive)
- `unrs-resolver` (eslint-config-next transitive)

The plan (§5.4 Task 2) does not address this — earlier pnpm versions accepted
the approval list under `package.json` → `pnpm.onlyBuiltDependencies`.

Two surprises:

1. `package.json#pnpm` is **silently ignored** in pnpm 11.2 — the install just
   warns *"The `pnpm` field in package.json is no longer read by pnpm"* and
   then still exits 1 with `ERR_PNPM_IGNORED_BUILDS`.
2. The new home is `pnpm-workspace.yaml` (even for single-package repos), and
   the schema also changed: the key is now `allowBuilds:` with an **explicit
   boolean per package**, not `onlyBuiltDependencies` taking an array.

Because `pnpm typecheck` / `pnpm build` (and any other script under pnpm 11.2
when `verify-deps-before-run` is on by default) triggers an implicit install,
the failure cascaded to every subsequent task. Without resolving it, no
validation step in §5.5 would pass.

## Decision

Maintain native-build approval in `pnpm-workspace.yaml` at the repo root:

```yaml
allowBuilds:
  sharp: true
  unrs-resolver: true
  "@tailwindcss/oxide": true
  esbuild: true
```

Tailwind's oxide and esbuild are pre-listed for Phase 1 (Tailwind wiring) and
for any tool that pulls esbuild — pre-approving them avoids future restarts.

## Consequences

- Adding a new dependency that ships a native build script will fail the first
  install with `ERR_PNPM_IGNORED_BUILDS`; the developer must add an entry to
  `pnpm-workspace.yaml#allowBuilds` and re-run.
- The CI install will inherit the same allow-list (the file is committed),
  so CI behaviour matches local.
- If pnpm changes the schema again, this file is the single place to update.

## Alternatives considered

- **Disable `verify-deps-before-run`** via `.npmrc`. Rejected: it hides
  genuine drift between `pnpm-lock.yaml` and `node_modules` and would let
  unapproved native scripts run anyway.
- **Use `--ignore-scripts=true`** on install. Rejected: breaks Next.js
  (sharp's `install/check.js` is required) and Playwright browser install.
- **Pin to pnpm 10.x** where the old config still worked. Rejected: pnpm 11
  is current upstream, and we will inherit the same migration eventually.

## References

- pnpm migration note: <https://pnpm.io/settings>
- The change was discovered on the first `pnpm install` of Phase 0 Task 2.
