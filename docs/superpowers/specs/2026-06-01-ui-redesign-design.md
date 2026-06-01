# Outreach Hub — UI Redesign (Claude Design port)

**Date:** 2026-06-01
**Status:** Approved design — ready for implementation planning
**Scope:** Restyle the entire authenticated app to match the "Outreach Hub"
Claude Design prototype, preserving 100% of existing functionality.

---

## 1. Context

The app (Phases 1–5) is fully functional but visually unstyled: every page
uses inline `React.CSSProperties`, a plain horizontal top-nav, and `system-ui`.
There is no Tailwind, no CSS system, no shared shell.

A Claude Design prototype was delivered as a zip (`Outreach Hub.zip`): a
self-contained **React-18-UMD + Babel-standalone** prototype driven by a
`data.js` mock. It ships four stylesheets — `tokens.css` (full design-token
system), `components.css`, `shell.css`, `screens.css` — and `.jsx` screens.

**The prototype is reference material, not importable code.** Its JSX and mock
data will not be copied. Its CSS will be.

### Visual language (from the prototype)

- Dark slate sidebar (`--bg-sidebar: --neutral-900`), grouped nav
  (Outreach / Data / Insights).
- Teal accent (`--teal-600` primary action).
- Geist + Geist Mono typography.
- Light, card-based content area; topbar with collapse toggle, page title,
  "sending as" mailbox chip, and ⌘K command entry.
- Full token system: neutral ramp, semantic status hues, spacing (4px base),
  radius, elevation, motion, z-index scale, and a scaffolded dark theme.

---

## 2. Goals & non-goals

### Goals

- Bring the entire authenticated app onto the design's visual language.
- Preserve **all** existing functionality and behavior exactly.
- Keep the full CI suite green (typecheck, lint, vitest, playwright, build)
  after every phase.
- Production-grade: real fonts via `next/font`, correct server/client
  component boundaries, preserved accessibility, no prototype scaffolding
  (no Babel, no UMD React, no mock data).

### Non-goals

- No changes to `lib/`, server actions, route handlers, data queries, or any
  business logic. **This is markup + CSS only.**
- No new product features beyond presentation.
- No fake/non-functional UI. Anything in the prototype that lacks a real
  backend is omitted (see §5).
- Not introducing Tailwind. The design is authored in plain CSS + custom
  properties; we port it verbatim to avoid translation drift.

---

## 3. Styling approach — verbatim CSS port

**Decision:** adopt the prototype's stylesheets as-is rather than re-deriving
them in Tailwind. Rationale: the token system is already coherent and audited;
porting verbatim guarantees 1:1 fidelity and produces small, reviewable diffs.

- Copy `tokens.css`, `components.css`, `shell.css`, `screens.css` into
  `app/styles/` (keeping their original filenames). Import them from
  `app/layout.tsx`.
- Replace the CDN Geist `<link>` with `next/font/google` (Geist + Geist Mono),
  exposing the family via the existing `--font-sans` / `--font-mono` tokens.
- Restyle pages by replacing inline `React.CSSProperties` with the design's
  **className-based** markup. No CSS-in-JS, no inline style objects except
  genuinely dynamic values (e.g. a progress-ring percentage).
- Re-author every screen as real Next.js components against live data. The
  prototype's `.jsx` files and `data.js` are read for structure/classes only.

### Reusable primitives

Extract the prototype's repeated component patterns (`components.css` +
`components.jsx`) into real React components under `components/ui/` (the
location CLAUDE.md already reserves for UI primitives): e.g. `Button`, `Badge`,
`CountBadge`, `Avatar`, `Card`, `Table` wrappers, `StatCard`, `EmptyState`,
status pills. Each is a focused, independently-testable unit with a clear prop
interface. Server components by default; `'use client'` only where the
prototype's interactivity requires it.

---

## 4. App shell

Replaces `components/site-nav.tsx` (current horizontal top-nav).

### Structure

- **Server wrapper** (`components/shell/app-shell.tsx` or similar): performs the
  per-request `supabase.auth.getUser()` check (as `site-nav.tsx` does today),
  returns `null`/bare children when signed out (so `/login` renders without the
  shell), and passes real user/mailbox data into the client shell.
- **Client shell**: renders sidebar + topbar + content slot, owns the
  collapse state and ⌘K palette state.
- **Sidebar**: grouped nav matching the prototype (Outreach: Today, Email
  Queue [+ due badge], Dialler, Pipeline · Data: Contacts, Campaigns,
  Sequences, Templates, Suppressions · Insights: Reports, Settings). Active
  route highlighting via `usePathname()`. User dropdown at the foot with
  sign-out (keeps the existing POST `/auth/signout` form).
- **Topbar**: collapse toggle, current page title, "sending as" chip, ⌘K entry.

### Nav mapping (prototype id → existing route)

| Prototype | Route |
|---|---|
| today | `/today` |
| queue | `/queue` |
| dialler | `/dialler` (AMD at `/dialler/amd`) |
| pipeline | `/pipeline` |
| contacts | `/contacts` |
| campaigns | `/campaigns` |
| sequences | `/sequences` |
| templates | `/templates` |
| suppressions | `/suppressions` |
| reports | `/reports` |
| settings | `/settings` |

Existing routes not in the prototype's primary nav (`/activity`, `/import`)
remain reachable (kept in nav or surfaced contextually — finalized in
planning); they are not dropped.

### Chrome decisions (user had no preference → pragmatic defaults)

- ✅ **Collapsible sidebar** — client state only.
- ✅ **"Sending as" chip** — bound to the real authenticated user / configured
  mailbox, not mock data.
- ✅ **Command palette (⌘K)** — implemented as **page-navigation only**
  (jump to a page). No fake free-text search.
- ✅ **Dark mode toggle** — tokens already scaffold `[data-theme="dark"]`; add
  a working toggle persisted to `localStorage`, applied without FOUC. Built in
  the final polish phase.
- ❌ **Notification bell** — omitted (no notifications backend).
- ❌ **Free-text global search box** — omitted (no search backend); its intent
  is partially served by the ⌘K page-nav palette.

---

## 5. Functionality preservation (hard requirement)

- No edits to `lib/`, `app/**/actions.ts`, `app/api/**`, `app/auth/**`, or any
  query/business logic. Presentation layer only.
- Every interactive element keeps its **current accessible name / visible
  text** so the e2e suite stays green. Known test-coupled strings that MUST be
  preserved:
  - Login: heading `Sign in`, button `Sign in with Microsoft`, button
    `Dev sign-in (mock)`.
  - Email runner: `Run sender now`, `Scan inbox now`, `Simulate inbound (dev)`,
    `Sim reply`, `Sim bounce`, textbox `Contact email to simulate inbound
    from`, and result strings (`Sent 2…`, `Simulated a reply`, `Simulated a
    bounce`, `1 repl…`).
  - AMD: `Start AMD Run`, `Mock dialler — no real calls placed`,
    `1 voicemails…`.
  - Sanity: `rhea@e2e.example.com` visibility post-login.
  - Where the prototype's label differs from a test-coupled string, **the
    test-coupled string wins**.
- Forms keep their `action` / `name` / server-action wiring untouched; only
  markup/classes change.
- Prototype mock metrics (e.g. "31/45 emails", "9 calls connected") are
  placeholders. Bind to real data where it already exists; **omit** any metric
  the app does not compute (no fabricated stats).

---

## 6. Phasing (each phase = one reviewable PR; full green CI between)

- **Phase A — Foundation:** stylesheets + tokens + `next/font` Geist + app
  shell (sidebar/topbar/collapse/sending-as/⌘K) + `components/ui/` primitives.
  Restyle **Login**. Lands the whole app on-brand immediately.
- **Phase B — Outreach hero screens:** Today/Dashboard, Email Queue (+ runner),
  Dialler (+ AMD), Pipeline.
- **Phase C — Data screens:** Contacts (list / detail / new / edit), Campaigns
  (+ new / edit), Sequences (+ new / detail), Templates (+ new / edit),
  Suppressions, Import.
- **Phase D — Insights + polish:** Reports, Activity, Settings, dark-mode
  toggle, responsive/mobile pass.

Branch per phase (`feat/ui-phase-a` …), squash-merge to `main`. Trunk-based,
PR-only, per CLAUDE.md.

---

## 7. Testing strategy

After every phase, all must pass before the phase is "done":

```
make typecheck   # tsc --noEmit (strict + noUncheckedIndexedAccess etc.)
make lint        # eslint .
make test        # vitest (unit)
make test-e2e    # playwright
make build       # next build (production)
```

- Existing unit tests target `lib/` logic and are unaffected by a
  presentation-only change; they act as a regression guard that no logic moved.
- E2e tests are the primary guard for preserved user-facing behavior; the
  string-preservation rule in §5 keeps them green.
- If a phase requires touching a test (e.g. an intentionally reworded button),
  the change is called out explicitly in that phase's PR with justification.

---

## 8. Risks & mitigations

- **E2e selector breakage** — mitigated by the §5 string-preservation rule and
  running `make test-e2e` per phase.
- **Server/client boundary mistakes** (e.g. adding `'use client'` to a page
  that does server data fetching) — mitigated by keeping data fetching in
  server components and isolating interactivity into small client leaves.
- **FOUC on dark mode / font** — `next/font` handles font; dark-mode toggle
  applies the `data-theme` attribute pre-paint via a tiny inline script in
  `layout.tsx`.
- **Scope creep into logic** — enforced by the "presentation only" rule;
  unit-test suite flags accidental logic changes.
