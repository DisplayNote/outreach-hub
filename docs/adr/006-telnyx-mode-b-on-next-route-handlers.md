# ADR 006: Telnyx AMD "Mode B" on Next.js route handlers, not Supabase Edge Functions

## Status

Accepted (Phase 4 planning, 2026-05-31).

## Context

The execution plan (§3 roadmap) describes dialler "Mode B" — server-orchestrated answering-
machine detection — as "Telnyx webhook → **Edge Function** → Postgres → Realtime". That
wording was inherited from the legacy reference implementation, where the system was a
browser-only single-file PWA with **no server of its own**: a separate Cloudflare Worker
(`legacy/worker.js`) existed solely to give Telnyx a stable webhook URL and to make
Call-Control API calls with a secret the browser could not safely hold. The Worker was the
*substitute* for a backend, not a deliberate architectural preference for edge functions.

Outreach Hub is the opposite situation: it is a Next.js app deployed on Vercel with a real
server tier and a service-role path to Supabase Postgres. The Mode-B control plane needs only
three server-side capabilities:

1. Place a call — a Telnyx API call holding `TELNYX_API_KEY` (server-side).
2. Receive Telnyx webhooks at a public HTTPS URL, Ed25519-verified.
3. Write call state to Postgres (service role); Supabase Realtime fans it out.

Only capability (2) requires a *public* endpoint (Telnyx posts to it). Capabilities (1) and
(3) are initiated by our own authenticated app, so they are Server Actions, not public routes.
Supabase Realtime is a property of Postgres, independent of which process writes the rows.

A Supabase Edge Function (Deno) was considered and rejected for this phase.

## Decision

Host the Mode-B control plane in the **Next.js server**:

- The Telnyx webhook receiver is a **Route Handler**: `app/api/telnyx/webhook/route.ts`.
- Dial / hang-up / bridge are **Server Actions** (`lib/actions/dialler-amd.ts`), calling the
  Telnyx API server-side under the user's Supabase session — no public dial endpoint, no
  shared secret in the client bundle.
- The pure orchestration — the event→state reducer, Ed25519 verification, the AMD dial-payload
  builder, and the mock backend — lives in `lib/dialler/amd/` and is unit-tested in isolation.
  The webhook route (real path) and the `MockTelnyxBackend` (local/dev) both drive the *same*
  reducer, so the host is a thin shell over testable logic.

This deviates from the roadmap's "Edge Function" wording; this ADR records the deviation.

## Rationale

- **One runtime, one language, one deploy target.** Edge Functions are Deno — a separate
  toolchain (`deno check`, `supabase functions serve`), a separate deploy, and a second place
  for secrets. Route handlers are the same Node/TypeScript/`lib/` code as the rest of the app.
- **Simpler local mock.** Local dev is a persistent `next dev` process, so `MockTelnyxBackend`
  can drive the AMD lifecycle on plain timers and call the reducer in-process — no Deno
  background-task constraints and no functions runtime to boot. This directly serves the
  Phase-4 requirement that Mode B be fully runnable and testable locally with no Telnyx
  account (mirroring dev mock-auth).
- **Consistency with Phase 5.** The email runner (`docs/PHASE_5_SPEC.md`) is likewise a
  `CRON_SECRET`-gated Next route + Server Actions (its drivers are Node). Splitting the dialler
  onto Deno would be a gratuitous architectural fork.

## Consequences

- **Trade-off — co-location/latency:** a Supabase Edge Function would sit marginally closer to
  Postgres and on a globally distributed edge. At this scale (single-digit users, quick webhook
  writes) the difference is immaterial.
- **Trade-off — coupling:** the telephony control plane now shares the web app's deploy and
  scaling. If a future need arises to scale or deploy it independently, extracting the
  `lib/dialler/amd/` core behind an Edge Function (or any other host) is a localized change,
  precisely because the logic is host-agnostic and already isolated.
- The Telnyx webhook URL is a Vercel route (`/api/telnyx/webhook`) configured in the Telnyx
  Call Control Application; Telnyx server-side env (`TELNYX_API_KEY`, `TELNYX_CONNECTION_ID`,
  `TELNYX_PUBLIC_KEY`, `BRIDGE_SIP_USERNAME`, …) lives in the Vercel project env and the Zod
  schema in `lib/env.ts`, not in Supabase function secrets.
- No `supabase/functions/` directory is introduced for the dialler.
