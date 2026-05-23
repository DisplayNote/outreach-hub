# ADR 004 — `export const dynamic = 'force-dynamic'` on the auth-gated home page

- **Status:** Accepted (retroactive — implemented during Phase 0 bootstrap, commit `83b47dd`)
- **Date:** 2026-05-23

## Context

`app/page.tsx` is the post-login landing route. On every render it calls
`createClient()` from `lib/supabase/server.ts`, which awaits `cookies()` and
asks Supabase for the current user. If there's no user it redirects to
`/login`. The page itself is therefore inherently dynamic — its output
depends on the request's auth cookies.

During `next build`, Next.js attempts to prerender every route by default
unless the route opts out (typically by reading `cookies()`, `headers()`,
`searchParams`, or `revalidate: 0`). In our setup the prerender step ran
the page module, which in turn called `getPublicEnv()` (Zod-validated env
parser). With no `.env.local` present at build time on a clean CI runner —
or even locally before bootstrap — Zod throws and the build fails:

```
Invalid public env: NEXT_PUBLIC_SUPABASE_URL: Invalid input; ...
```

Even though the route would never produce a static result in practice,
Next still tried to evaluate it. In Phase 0, the build needs to succeed
without any of the real env values (CI uses a placeholder anon key
purely to satisfy the parser; the route is never actually hit during
build).

## Decision

Mark the home page explicitly dynamic:

```ts
// app/page.tsx
export const dynamic = 'force-dynamic';
```

This skips the prerender attempt entirely. The route is server-rendered
on demand; the request always has cookies and runtime env vars when it
executes.

## Consequences

- `app/page.tsx` will never be statically optimized. That's the correct
  behaviour for an auth-gated page.
- Routes that *can* be prerendered (the marketing site, public docs, the
  `/login` client component) remain static and get the benefit of CDN
  caching.
- The pattern generalises: any new route that calls `createClient()` from
  `lib/supabase/server.ts` should declare `export const dynamic =
  'force-dynamic'` (or use Server Actions / Route Handlers, which are
  dynamic by default).

## Alternatives considered

- **Make `getPublicEnv()` tolerant of missing values during build.** Rejected:
  weakens the contract that the rest of the code relies on. A missing env
  var at runtime should crash loudly, not silently use defaults.
- **Inject placeholder env values via a `next.config.mjs` build-time check.**
  Rejected: leaks a fake URL into the static bundle and confuses observability.
- **Mark the page `dynamic = 'force-dynamic'` only in CI** via a conditional.
  Rejected: introduces a code path that differs between local and CI builds.
- **Wrap the `cookies()` call in `unstable_noStore()`.** Rejected: works in
  current Next 15 but is explicitly marked unstable, while `dynamic =
  'force-dynamic'` is the documented public API.

## References

- Next.js route segment config:
  <https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config>
