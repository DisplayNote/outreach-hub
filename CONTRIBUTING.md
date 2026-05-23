# Contributing

## Branch model

Trunk-based. `main` is production. Feature branches are short-lived and named:

```
feat/<scope>     New feature
fix/<scope>      Bug fix
chore/<scope>    Tooling / dependencies / non-functional
docs/<scope>     Documentation only
refactor/<scope> Refactor without behaviour change
test/<scope>     Test-only changes
infra/<scope>    Infrastructure / IaC
```

Merge via **squash**.

## Commits

[Conventional commits](https://www.conventionalcommits.org/). Subject line under 72 chars,
body wraps at 100. Examples:

```
feat(auth): wire Microsoft OAuth sign-in
fix(dialler): respect skip-list for repeat numbers
refactor(email): extract NotImplementedError from base error
infra(supabase): pin Postgres major to 17
```

## TypeScript

- `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitOverride`.
- No `@ts-ignore`. Use `@ts-expect-error <reason>` only when truly unavoidable.
- Imports use the `@/*` alias for anything inside the repo. No `../../..` chains.
- Server vs client: follow Next.js App Router conventions. Add `'use client'` only when
  strictly necessary (event handlers, hooks, browser-only APIs).

## Tests

- Every behaviour change ships with a test or a documented reason why not.
- Unit tests live next to logic in `tests/unit/<area>/`.
- E2E flows live in `tests/e2e/`.
- Mocking the database is forbidden by default — prefer Supabase's local stack.

## PR checklist

The template (`.github/pull_request_template.md`) covers it. Tightening points:

- Keep PRs focused. If you're touching infra and code in one PR, split unless they're truly
  coupled.
- Migrations must be reversible (or document the rollback inline).
- No plaintext secrets in the diff, ever — including snapshots and fixtures.

## Reviewing

- One approval is enough until the team grows past two engineers.
- Self-review the diff before opening the PR. Most "Claude found a bug" comments could have
  been caught here.
- For schema or auth changes, request review from anyone with `infra/` ownership.
