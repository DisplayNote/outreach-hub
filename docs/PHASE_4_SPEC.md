# Phase 4 — Executable Spec: Dialler "Mode B" (server-orchestrated AMD)

**Status:** DRAFT for execution. **Phase:** 4 (per execution plan §3 — "Dialler Mode B
(AMD via Edge Function): Telnyx webhook → Edge Function → Postgres → Realtime al frontend;
verificación HMAC; multi-usuario"). **Architecture deviation from that wording:** the Telnyx
webhook receiver and call-control calls are hosted in a **Next.js Route Handler + Server
Actions**, *not* a Supabase Edge Function — the roadmap named an Edge Function only because the
legacy app was browser-only with no server (the Cloudflare Worker filled that gap). Now that
there is a real Next.js server, the webhook belongs in it. See **ADR 006**.
**Depends on:** Phase 1 (schema, RLS, `contacts`/`touchpoints`, `current_org_id()`),
Phase 2 (CRUD surface, `logTouchpoint`, `setContactStatus`), Phase 3 (the `DiallerDriver`
seam in `lib/dialler/`, the canonical outcome catalogue in `lib/dialler/outcomes.ts`,
phone normalisation, the run-dialler UI at `app/dialler/`).
**Source of truth mined:** `legacy/worker.js` (the 389-line Cloudflare AMD Worker — the
authoritative AMD orchestration: `/dial` L66–141, `/telnyx` webhook L165–274,
`call.machine.detection.ended` handling L213–239, `bridgeToBrowser` L278–293, SSE
`/events` L297–345, AMD config L86–97), `legacy/MIGUEL_HANDOVER.md` §7.2 (Mode B), §4.3
(touchpoint discipline), §8 (Telnyx setup), §9 (Worker), §11 (compliance),
`docs/PHASE_3_SPEC.md` §0/§3 (the Mode B boundary it deferred to Phase 4), the legacy
PWA AMD SSE handlers (`diallerWorkerDial`, `diallerOpenSSE`, `diallerHandleSSE`,
`diallerLogVoicemailTouchpoint`, "Start AMD Run", L7145–7219 per the PHASE_3_SPEC
citation), `lib/dialler/*`, `lib/actions/dialler.ts`, `lib/env.ts` (the
`isAuthMockEnabled` triple-gate this spec's mock gate mirrors), `supabase/config.toml`
(`[realtime] enabled = true`), `docs/adr/006-telnyx-mode-b-on-next-route-handlers.md`.

This document is implementation-oriented. It does **not** contain app code — it specifies
what Phase 4 must build. Decisions already resolved with the product owner are marked
**[RESOLVED]**; choices defaulted by this spec and offered for confirmation at the
spec-review gate are marked **[DECISION]**.

---

## 0. Scope boundary (what Phase 4 is and is NOT)

**In scope — Mode B (server-orchestrated AMD):**

- A **Next.js Route Handler** (`app/api/telnyx/webhook`) that receives Telnyx webhooks and
  drives each call's disposition, plus **Server Actions** (`placeAmdCall`, `hangupAttempt`,
  `bridge`) that call the Telnyx Call Control API with Answering-Machine Detection enabled —
  together replacing the legacy Cloudflare Worker. Only the webhook is a public endpoint
  (Telnyx must POST to it); dial/hangup/bridge are app-initiated and authenticated, so they
  are Server Actions, not public routes. The pure orchestration (event→state reducer,
  signature verify, AMD dial-payload, mock backend) lives in `lib/dialler/amd/`, so the host
  is a thin shell over testable logic (see ADR 006).
- **Persistence of call state in Postgres** (`call_runs`, `call_attempts`, `call_events`)
  instead of the legacy in-memory `Map` (worker.js L25–26), so state is durable,
  org-scoped, multi-user, and survives function cold-starts.
- **Supabase Realtime** pushing per-attempt state to the client (replacing the legacy SSE
  `/events` stream, worker.js L297–345).
- **AMD lifecycle**: dial → ringing → answered → `machine.detection.ended` → auto-hangup
  (machine) **or** bridge-to-rep (human), → hangup, with the exact disposition + touchpoint
  rules of handover §4.3 / §7.5.
- A **mock Telnyx backend** that simulates the entire Call-Control + webhook lifecycle with
  **no Telnyx account, API key, or SIP credentials**, gated exactly like dev mock-auth
  (`lib/env.ts` `isAuthMockEnabled`), so the whole Mode-B flow is runnable and testable
  locally through `/auth/mock`.
- The **`TelnyxDiallerDriver`** (today a stub, `lib/dialler/telnyx.ts` L9–15) implemented
  behind the existing `DiallerDriver` seam, plus a server-orchestration extension to the
  seam for the Mode-B control plane (§5).
- An **AMD run UI** ("Start AMD Run" alongside the Phase-3 "Start run") on `app/dialler/`:
  a queue, live per-attempt status driven by Realtime, per-run tallies, a manual
  hang-up/skip, and the human-answered hand-off to the Phase-3 click-to-call surface.

**Explicitly out of scope (later phases — do NOT build here):**

- **Voicemail-drop** (playing a pre-recorded message into a detected machine). **[RESOLVED:
  out]** Phase 4 hangs up on a machine and auto-logs a touchpoint, exactly as the legacy
  worker did (worker.js L225–230); the legacy decision log explicitly never shipped
  voicemail-drop. No audio-asset storage, no Telnyx `playback_start`. Documented as a future
  option in §11.
- **Real predictive / parallel dialling** (multiple concurrent live calls bridged to one
  rep). **[RESOLVED: sequential]** Phase 4 dials **one** AMD attempt at a time per run, like
  the legacy single-line flow. Parallel dialling is handover §12.2 #6, a later phase.
- **Real Telnyx connectivity in the dev/default build.** The default and test driver is the
  **mock** backend. The real Telnyx path compiles and is structurally complete, but is only
  exercised when real credentials are configured (a deploy concern, not part of local
  acceptance).
- **Call recording, CTPS screening, GDPR right-to-be-forgotten, hash-chained audit** —
  Phase 6 (handover §11). Phase 4 lays the durable `call_events` log that a future audit
  chain can build on, but adds no compliance gating.
- **The real WebRTC media leg for the bridged human call.** **[RESOLVED: simulated bridge]**
  When AMD detects a human, Phase 4 transitions the attempt to a `bridged` state and hands
  off to the **Phase-3 Mode-A click-to-call** surface for the rep to converse and log an
  outcome. In the mock build the media leg is simulated (no SIP). Wiring a real WebRTC
  bridge to a live SIP leg is a deploy-time concern reusing the same seam.

**Why a Next.js route handler (not an Edge Function, not a Worker, not client-side):** AMD is
inherently server-orchestrated — Telnyx must reach a stable webhook URL, decisions (hang up
vs bridge) must be made server-side within the call, and state must be shared across the
rep's devices and future teammates. The legacy Worker proved the pattern. Phase 4 hosts it in
the **app's own Next.js server** (one runtime, one language, one deploy target, reusing
`lib/` + the env-gating patterns) rather than a separate Supabase Edge Function (Deno): there
is no second toolchain, the local mock runs in-process under `next dev` (no functions runtime
to boot), and it stays consistent with the Phase-5 email runner (also a Next route). Call
state is RLS-scoped in Postgres rather than a single-instance in-memory `Map` (worker.js
L21–26, called out as non-scaling in handover §9.2). ADR 006 records this deviation from the
roadmap's "Edge Function" wording and its trade-offs.

---

## 1. Architecture & data flow

```
            ┌─────────────────────── browser (rep) ──────────────────────┐
            │  app/dialler  ── "Start AMD Run"                            │
            │     │  placeAmdCall(contactId)  (Server Action)             │
            │     │                                  ▲ Realtime           │
            └─────┼──────────────────────────────────┼────────────────────┘
                  ▼ (1) insert call_attempt          │ (5) postgres_changes
        ┌───────────────────────────────┐            │  on call_attempts /
        │  placeAmdCall (Server Action)  │            │  call_events (RLS-scoped)
        │   → AmdDiallerBackend.placeCall │           │
        └─────────────┬─────────────────┘            │
                      ▼ (2) /v2/calls (real) | mock   │
        ┌───────────────┐   ┌────────────────────────┐│
        │ Telnyx (real) │   │ MockTelnyxBackend (dev) ││
        └───────┬───────┘   │ simulates the same      ││
                │ (4)        │ webhook events on timers││
                │ webhooks   └───────────┬─────────────┘│
                ▼                        ▼ (4') direct call
        ┌─────────────────────────────────────────────────────────────┐
        │  app/api/telnyx/webhook  (Next.js Route Handler)             │
        │   • Ed25519-verifies the request (real path)                 │
        │   • calls lib/dialler/amd reducer → writes call_events +     │
        │     updates call_attempts (service-role client)              │
        └───────────────────────────────────────────────▲─────────────┘
                                                         │ (5)
```

Numbered flow:

1. Rep clicks **Start AMD Run**; the client calls a **`placeAmdCall` Server Action** which
   (a) resolves the dial number via the Phase-3 normaliser, (b) inserts a `call_attempts`
   row (`state = 'queued'`, org-scoped, carrying `contact_id` + `run_id`), and (c) calls the
   `AmdDiallerBackend.placeCall` for the attempt — all server-side, so no public dial endpoint
   and no shared secret in the client bundle.
2. The backend places the call: real Telnyx `POST /v2/calls` with AMD config
   (worker.js L82–104) **or**, in mock mode, the `MockTelnyxBackend`.
3. Telnyx (or the mock) begins the call. The Telnyx `call_control_id` is stored on the
   attempt for webhook correlation; metadata (`attempt_id`, `run_id`, `contact_id`) rides in
   `custom_headers` exactly like the legacy worker (worker.js L100–103) so a handler with no
   in-memory context can recover it from the payload (worker.js L182–191).
4. **Real path:** Telnyx POSTs webhooks to the public `app/api/telnyx/webhook` route, which
   Ed25519-verifies them. **Mock path (4'):** the `MockTelnyxBackend` calls the **same
   `lib/dialler/amd` reducer** directly, in-process, on timers — no HTTP, nothing to sign.
   Both feed identical state transitions.
5. The reducer updates the `call_attempts` state and appends a `call_events` row (service-role
   client). Because both tables are Realtime-published, the client receives the transition
   over a **Realtime channel filtered to the current `run_id`**, with no SSE.

**Why Postgres + Realtime instead of in-memory + SSE:** durability (a restarted server
recovers from the row, not a lost `Map` entry), multi-user/multi-device (any of the rep's
sessions subscribed to the run sees the same state), and RLS (a run and its attempts are
visible only to the owning org). Realtime `postgres_changes` is already enabled
(`config.toml [realtime] enabled = true`) and needs only the tables added to the
`supabase_realtime` publication.

---

## 2. Data model (new migration `*_phase4_dialler_amd.sql`)

Three new org-scoped tables, following the Phase-1/2 conventions exactly (denormalised
`org_id`, RLS `org_id = public.current_org_id()`, `set_updated_at()` triggers where a row is
mutable). All three are added to the `supabase_realtime` publication.

### 2.1 `call_runs` — one AMD run (a batch the rep started)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid not null → organizations | RLS scope |
| `mode` | text not null default `'amd'` | `'amd'` for Mode B; future-proofs for other run modes |
| `status` | text not null default `'active'` | `active` / `paused` / `done` |
| `created_by` | uuid not null → users(id) | the rep who started it |
| `created_at` / `updated_at` | timestamptz | |

The `run_id` is what the client subscribes to over Realtime and what correlates attempts —
the durable equivalent of the legacy in-browser `runId` (worker.js `runId` throughout).

### 2.2 `call_attempts` — one dialled contact within a run (the live state row)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | the `attempt_id` carried in `custom_headers` |
| `org_id` | uuid not null → organizations | RLS scope |
| `run_id` | uuid not null → call_runs(id) on delete cascade | |
| `contact_id` | uuid not null → contacts(id) on delete cascade | |
| `to_number` | text not null | normalised E.164 actually dialled |
| `from_number` | text | outbound CLI used |
| `provider` | text not null default `'telnyx'` | or `'mock'` |
| `call_control_id` | text | Telnyx correlation id (null until the dial call returns) |
| `state` | `public.call_attempt_state` enum not null default `'queued'` | see §3 |
| `amd_result` | text | `human` / `machine` / `not_sure` / `fax` / `human_residence` (worker.js L215) |
| `disposition` | text | terminal classification (`voicemail-auto` / `bridged-human` / `no-answer` / `failed` / `cancelled`) |
| `hangup_cause` | text | from `call.hangup` (worker.js L253) |
| `error` | text | driver/Telnyx failure detail |
| `started_at` / `ended_at` | timestamptz | |
| `created_at` / `updated_at` | timestamptz | |

Indexes: `(run_id)`, `(org_id, state)`, unique `(call_control_id)` where not null (webhook
correlation arbiter).

### 2.3 `call_events` — append-only per-attempt event log (audit + Realtime feed)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid not null → organizations | RLS scope |
| `attempt_id` | uuid not null → call_attempts(id) on delete cascade | |
| `event_type` | text not null | the Telnyx event name (`call.initiated`, `call.answered`, `call.machine.detection.ended`, `call.hangup`, …) or a synthetic `amd.result` / `call.bridge_human` / `call.machine_hangup` (worker.js L199–263) |
| `payload` | jsonb not null default `'{}'` | the (verified) Telnyx payload, or the mock's equivalent |
| `occurred_at` | timestamptz not null default now() | |
| `created_at` | timestamptz | |

Append-only, like `touchpoints` (no UPDATE/DELETE policy — RLS enforces immutability,
mirroring the Phase-1 touchpoints policy). This is the auditable record a Phase-6 hash chain
can later sign.

### 2.4 RLS

- **Client (authenticated):** SELECT on all three scoped to `org_id = current_org_id()`
  (this is what makes Realtime deliver only the org's rows). INSERT on `call_runs` and
  `call_attempts` for the owning org (the rep starts runs / queues attempts via Server
  Actions). **No** client UPDATE/DELETE on `call_events` (append-only); client UPDATE on
  `call_attempts`/`call_runs` limited to the columns the UI legitimately changes (e.g.
  pausing a run, user-cancel) — **[DECISION 4.1]**: keep all state-machine writes
  server-side (the webhook route / Server Actions, via the service-role client) and grant the
  client only `status` on `call_runs` (pause/stop) + a `cancel`-intent on its own attempts, so
  the lifecycle can't be corrupted from the browser. Recommended.
- **Server side (webhook route + Server Actions):** uses the **service-role** client
  (bypasses RLS) and always sets `org_id` explicitly from the attempt it loaded — the server
  is the only writer of call state and events, exactly as the legacy worker was the only
  mutator of the `Map`.

### 2.5 `call_attempt_state` enum

```
queued · dialing · ringing · answered · machine · bridged · ended · failed
```

declared verbatim (lower-case) like `contact_status` / `touchpoint_channel`. (`answered`
doubles as the "AMD analysing" phase — Telnyx sends `call.answered` then
`call.machine.detection.ended` with no distinct in-between event, so no separate
`amd_pending` state is needed.)

---

## 3. Call lifecycle state machine

Maps the legacy worker's event handling (worker.js L196–271) onto the durable
`call_attempts.state`. The browser **never** drives these transitions — it observes them via
Realtime.

| State | Set by (event) | Meaning | Terminal? |
|---|---|---|---|
| `queued` | `placeAmdCall` insert | Attempt created, not yet dialled. | no |
| `dialing` | dial call accepted (worker.js L119 `state:'dialing'`) | Telnyx/mock has the call. | no |
| `ringing` | `call.ringing` (L202–204) | Remote ringing. | no |
| `answered` | `call.answered` (L207–211) | Answered; AMD analysing. **Do not bridge yet — await AMD** (L210). | no |
| `machine` | `machine.detection.ended` with `result ∈ {machine, fax}` (L225) | Machine detected → auto-hangup scheduled (L227–229). | →`ended` |
| `bridged` | `machine.detection.ended` with `result ∈ {human, not_sure, human_residence}` (L231–238) | Human → hand off to rep (simulated bridge). | →`ended` |
| `ended` | `call.hangup` (L251–266) | Call over. `disposition` finalised. | yes |
| `failed` | `/dial` error (L108–112) or Telnyx error event | Could not place/progress. | yes |

**Happy paths:**
`queued → dialing → ringing → answered → machine → ended` (voicemail), or
`… → answered → bridged → ended` (human conversation).
**No-answer:** `queued → dialing → ringing → ended` (timeout hangup; `disposition =
'no-answer'`). **Fail:** `queued → failed`.

`not_sure` and `human_residence` are treated as **human** (legacy bridged them, L231–238).

---

## 4. AMD result → disposition, status, and touchpoint discipline [RESOLVED]

This is the heart of the phase and must match handover §4.3 + §7.5 + the worker exactly.

| AMD / terminal outcome | Auto-hangup? | Touchpoint logged? | Note | Contact status |
|---|---|---|---|---|
| **machine / fax** | Yes, server-side (worker.js L227) | **Yes** — auto | `Voicemail reached — auto` (handover §4.3, legacy `diallerLogVoicemailTouchpoint`, L7167/L7215) | unchanged |
| **human / not_sure / human_residence** | No — bridge to rep | **No auto-touchpoint** — the rep logs the outcome via the Phase-3 panel | (rep's note) | per Phase-3 outcome mapping |
| **no-answer** (ring timeout, never answered) | Yes (timeout) | **No** (handover §4.3: AMD no-answer does NOT log, to avoid CRM pollution; legacy L7197–7204) | — | unchanged |
| **failed** (dial error / unallocated number) | n/a | **No** | — | unchanged |

Key rules:

- **The auto-VM touchpoint is written server-side** (in the webhook route's reducer, via the
  service-role client — `channel = 'phone'`, `note = 'Voicemail reached — auto'`, `org_id`
  from the attempt) at the moment it auto-hangs-up on a machine — not by the browser, because
  the browser may not be watching. This is the **one** new server-side write path for
  touchpoints; it reuses the exact column shape of `lib/actions/dialler.ts` L125–131.
- **The human-bridge path writes NO touchpoint automatically.** Bridging hands control to the
  Phase-3 click-to-call surface; when the rep finishes, they log an outcome through the
  **existing `logCallOutcome` Server Action** (`lib/actions/dialler.ts`), which appends the
  `phone` touchpoint and applies the status side-effect. Mode B adds nothing new here.
- **No-answer logs nothing.** This is the deliberate CRM-cleanliness rule (handover §4.3) and
  is the single behavioural difference from Mode A (where the rep manually logs even a
  no-answer). The Phase-3 spec §3 flagged this for the Phase-4 author to preserve — this spec
  honours it.

---

## 5. The `DiallerDriver` seam extension (control plane)

The Phase-3 `DiallerDriver` interface (`lib/dialler/driver.ts`, `placeCall` returning a
client-side `CallControl`) models **Mode A** (the browser owns the call). Mode B's call is
owned by the **server**, so Phase 4 adds a parallel, **server-side control-plane interface**
rather than overloading `placeCall`:

**`AmdDiallerBackend`** (new, `lib/dialler/amd/backend.ts`) — the server-side control plane,
called by the `placeAmdCall`/`hangupAttempt` Server Actions and the webhook route, with two
implementations:

- `placeCall({ to, from, attemptId, runId, contactId }): Promise<{ callControlId }>` — start
  an AMD call (real Telnyx `POST /v2/calls` with the AMD config below, or mock).
- `hangup(callControlId): Promise<void>` — worker.js `/hangup` (L145–161).
- `bridge(callControlId, target): Promise<void>` — transfer the human-answered leg
  (worker.js `bridgeToBrowser` L278–293); in mock mode this just advances state.
- `handleWebhook(rawBody, signatureHeaders): Promise<void>` — verify, then apply the §3/§4
  state transitions and writes (worker.js `handleTelnyxWebhook` L165–274). This is the pure
  reducer the webhook route (real) and the mock backend (simulated) both call.

Two implementations behind a factory mirroring `getDiallerDriver()`:

- **`TelnyxAmdBackend`** — real Call-Control API + Ed25519 webhook verification (§6).
- **`MockTelnyxBackend`** — simulates the lifecycle (§7).

The browser-facing `TelnyxDiallerDriver` (`lib/dialler/telnyx.ts`, currently the
`NotImplementedError` stub) is implemented for the **Mode-A WebRTC** leg used by the
human-bridge hand-off; for Mode B the browser does not place the call directly — it calls the
`placeAmdCall` Server Action and observes Realtime. **[DECISION 5.1 — RESOLVED]:** `placeAmdCall`
is a **Server Action** that calls the Telnyx API server-side directly (the user's Supabase
session is the auth) — no public dial endpoint and no shared secret in the client bundle, in
contrast to the legacy browser→Worker `sharedSecret` (worker.js L70). Only the **webhook**
(which Telnyx itself calls) is a public route.

**AMD config** (the dial payload) is ported verbatim from worker.js L86–97
(`answering_machine_detection: 'premium'`, the `answering_machine_detection_config` block,
`timeout_secs` from `NO_ANSWER_TIMEOUT_MS`/1000 default 22, `custom_headers` carrying
`attempt_id` / `run_id` / `contact_id`).

---

## 6. Real Telnyx path (structurally complete; exercised only with credentials)

- **Webhook route `app/api/telnyx/webhook/route.ts`** (Next.js Route Handler, Node runtime):
  the single public endpoint Telnyx POSTs call events to (worker.js `/telnyx` handler shape,
  L165–274). Reads the raw body, Ed25519-verifies it, then runs the `lib/dialler/amd` reducer,
  writing via the Supabase **service-role** client. Dial/hangup/bridge are **Server Actions**
  (`lib/actions/dialler-amd.ts`), not routes, since the app initiates them.
- **Webhook signature verification [RESOLVED: real, replacing the legacy "trust by URL
  obscurity" L166–167].** Telnyx signs webhooks with **Ed25519** (`Telnyx-Signature-Ed25519`
  + `Telnyx-Timestamp` headers), not HMAC — the execution-plan §3 wording "HMAC" predates
  this detail; this spec uses Telnyx's actual scheme. Verify `timestamp|body` against the
  account's Telnyx public key (env `TELNYX_PUBLIC_KEY`), rejecting stale timestamps.
  **[DECISION 6.1]:** when `TELNYX_PUBLIC_KEY` is unset (local/mock), verification is
  **skipped** and the route only accepts mock-originated events (§7 gate) — never unsigned
  real traffic in a deployed env. Recommended.
- **Server env / secrets** (Next.js server env — Vercel project env in prod, `.env.local` in
  dev — added to the Zod schema in `lib/env.ts`, mirroring worker.js §9.3): `TELNYX_API_KEY`,
  `TELNYX_CONNECTION_ID`, `TELNYX_PUBLIC_KEY`, `BRIDGE_SIP_USERNAME`, optional `AMD_MODE`
  (default `premium`), `NO_ANSWER_TIMEOUT_MS` (default 22000). The service-role writes reuse
  the existing `SUPABASE_SERVICE_ROLE_KEY` / server Supabase URL already in `lib/env.ts`.
- **Bridge target:** `sip:${BRIDGE_SIP_USERNAME}@sip.telnyx.com` (worker.js L283).

No real Telnyx calls are made in CI or local acceptance — this path is verified by
unit-testing the pure pieces (signature verify, event→state reducer, dial-payload builder)
and by the mock backend driving the same reducer.

---

## 7. Mock Telnyx backend (the dev/test default) [RESOLVED: mirror mock-auth]

The defining requirement: **Mode B fully runnable and testable locally with no Telnyx
account, API key, or SIP creds**, the same way `/auth/mock` makes the RLS app runnable with
no Microsoft login.

- **Gate — `isDiallerMockEnabled()`** in `lib/env.ts`, triple-gated identically to
  `isAuthMockEnabled` (L100–106): `NODE_ENV !== 'production'` **and** an explicit
  `DIALLER_MOCK_ENABLED === 'true'` **and** the Supabase URL is a loopback host
  (`isLocalSupabaseUrl`). The server refuses to run the mock path unless gated, so a deployed
  app can never fabricate call events.
- **`MockTelnyxBackend`** (`lib/dialler/amd/mock-backend.ts`): on `placeCall`, it **schedules
  the same sequence of webhook events** the real Telnyx would send, against the same
  `handleWebhook` reducer — `call.initiated → call.ringing → call.answered →
  call.machine.detection.ended → call.hangup` — on short, configurable delays (mirroring
  `MockDiallerDriver`'s timer model, `lib/dialler/mock.ts` L20–24). Because it feeds the real
  reducer, the mock exercises the actual state-machine + DB-write + Realtime code, not a
  parallel fake.
- **Scenario selection (deterministic, no RNG — matches the repo's no-`Math.random()` rule):**
  the AMD result is chosen by a deterministic, inspectable rule so tests are reproducible and
  a local demo can show every branch. **[DECISION 7.1]:** derive the scenario from the dialled
  number / a per-attempt counter (e.g. cycle human → machine → no-answer, or honour a magic
  suffix like `…0001=human`, `…0002=machine`, `…0003=no-answer`), **and** allow an explicit
  override on the `placeAmdCall` input for tests. Recommended; final mapping confirmed at
  review. This mirrors how `MockDriver.inbound` is populated in tests for email.
- **How mock events reach the reducer:** in local dev the persistent `next dev` server runs
  the mock in-process — `MockTelnyxBackend` schedules the lifecycle on plain timers and calls
  the **same `lib/dialler/amd` reducer** the real webhook route calls, so there is **no real
  outbound HTTP** and nothing to sign. The reducer writes `call_events` / updates
  `call_attempts` via the service-role client, and Realtime fans out to the browser —
  identical client code to the real path.

The mock is the **only** backend exercised by `make test` and the `/auth/mock` live walk-through.

---

## 8. UI surfaces (`app/dialler/`)

Extends the Phase-3 run dialler; does not replace it.

- **Mode toggle:** alongside Phase-3 "Start run", add **"Start AMD Run"** (legacy "Start AMD
  Run" button, handover §7.2). Same contact picker/queue as Phase 3 (status/recency/country
  filters; default-excludes `notinterested`/`bounced`).
- **Live run view, Realtime-driven:** the queue shows each `call_attempts` row's `state`
  (§3) updating live via the run's Realtime channel — `dialing` / `ringing` / `answered` /
  "AMD analysing…" / **machine → "Voicemail — auto-logged"** / **human → "Connecting you…"**.
  Per-run tallies (humans bridged / voicemails / no-answers), replacing the legacy in-browser
  `DIAL.stats`.
- **Human hand-off:** on a `bridged` transition, the current contact opens in the **Phase-3
  click-to-call panel** so the rep converses (simulated media in mock) and logs an outcome via
  `logCallOutcome`. After the outcome, auto-advance to the next queued attempt (honouring the
  Phase-3 `txCallDelay` pacing).
- **Controls:** manual **Hang up** (the `hangupAttempt` Server Action) and **Skip** (cancel
  the queued attempt without dialling). **Pause/Stop** the run (`call_runs.status`).
- **Driver/health pill:** show whether the backend is `mock` or `telnyx` (like the Phase-3
  "Telnyx connected" pill), so it's obvious in dev that the mock is active.

---

## 9. New / changed files (inventory — no app code in this spec)

| Path | Purpose |
|---|---|
| `supabase/migrations/*_phase4_dialler_amd.sql` | `call_attempt_state` enum; `call_runs` / `call_attempts` / `call_events` tables + indexes + RLS + Realtime publication (§2). |
| `app/api/telnyx/webhook/route.ts` | Next.js Route Handler: the one public endpoint Telnyx POSTs to; Ed25519-verifies, then runs the reducer with service-role writes (§6). |
| `lib/dialler/amd/reducer.ts` | Pure event→state reducer + disposition/touchpoint rules (§3/§4) — unit-testable, called by the webhook route (real) and the mock backend (simulated). |
| `lib/dialler/amd/verify.ts` | Ed25519 `Telnyx-Signature` verification (§6) — pure. |
| `lib/dialler/amd/backend.ts` | `AmdDiallerBackend` interface + `getAmdBackend()` factory (§5). |
| `lib/dialler/amd/telnyx-backend.ts` | Real Telnyx Call-Control implementation (§6). |
| `lib/dialler/amd/mock-backend.ts` | `MockTelnyxBackend` — simulated lifecycle (§7). |
| `lib/dialler/amd/config.ts` | AMD dial-payload config ported from worker.js L86–97. |
| `lib/dialler/telnyx.ts` | Implement the Mode-A WebRTC leg used by the human bridge (replaces the stub). |
| `lib/actions/dialler-amd.ts` | `placeAmdCall`, `startAmdRun`, `cancelAttempt`, `hangupAttempt`, `setRunStatus` Server Actions (§1/§8); the server-side auto-VM touchpoint write (§4). |
| `lib/env.ts` | Add `isDiallerMockEnabled()` + the new Telnyx server-env schema entries (§6). |
| `app/dialler/` | AMD-run UI (§8), Realtime subscription hook. |
| `tests/unit/dialler/amd-reducer.test.ts` | Every §3 transition + §4 disposition/touchpoint rule. |
| `tests/unit/dialler/amd-verify.test.ts` | Ed25519 signature accept/reject (valid, tampered, stale). |
| `tests/unit/dialler/mock-backend.test.ts` | Each scenario (human/machine/no-answer/fail) drives the reducer to the right terminal state + writes. |
| `tests/e2e/amd-run.spec.ts` | Via `/auth/mock`: start an AMD run, observe Realtime transitions, assert the auto-VM touchpoint on a machine and the bridge hand-off on a human. |

---

## 10. Acceptance criteria

1. `supabase db reset` applies the Phase-4 migration cleanly; `call_runs` / `call_attempts` /
   `call_events` exist, are RLS-scoped to the org, append-only where specified, and are in the
   `supabase_realtime` publication.
2. With `DIALLER_MOCK_ENABLED=true` + local stack + `/auth/mock`, starting an **AMD run**
   drives an attempt through `queued → dialing → ringing → answered → {machine | bridged} →
   ended`, visible **live in the browser via Realtime** (no SSE, no polling).
3. **Machine** outcome: the server auto-hangs-up and **auto-logs exactly one `phone`
   touchpoint** `Voicemail reached — auto` on the contact; contact status unchanged.
4. **Human** outcome: **no** auto-touchpoint; the attempt reaches `bridged`, the Phase-3
   click-to-call panel opens, and the rep's `logCallOutcome` is the only touchpoint written.
5. **No-answer** outcome: attempt ends with `disposition = 'no-answer'` and **no touchpoint**
   (CRM-cleanliness rule, handover §4.3).
6. The event→state **reducer** and **Ed25519 verification** are unit-tested in isolation
   (valid/tampered/stale signature; every AMD branch); the **mock backend** drives the reducer
   to each terminal state with the correct DB writes — all without a Telnyx account.
7. The mock path **cannot** run in a production-like env: `isDiallerMockEnabled()` is false
   unless `NODE_ENV !== production` **and** the flag is set **and** the Supabase URL is
   loopback; the deployed webhook route rejects unsigned webhooks.
8. Sequential invariant: at most **one** non-terminal `call_attempts` row per active run.
9. `make typecheck`, `make lint`, `make test`, `make build` all green.

---

## 11. Open decisions (defaults chosen; confirm at review)

- **[DECISION 4.1]** Keep all call-state writes server-side; client gets only run pause/stop +
  attempt-cancel intents. *(Recommended.)*
- **[DECISION 5.1 — RESOLVED]** `placeAmdCall` is a Server Action calling Telnyx server-side
  (session auth); only the Telnyx webhook is a public route. No Edge Function, no shared secret
  in the client bundle (see ADR 006).
- **[DECISION 6.1]** No `TELNYX_PUBLIC_KEY` ⇒ skip signature verify **and** accept only
  mock-originated events; deployed envs always verify. *(Recommended.)*
- **[DECISION 7.1]** Mock AMD scenario chosen deterministically (number-suffix / cycling
  counter) with a per-attempt test override — no RNG. Confirm the suffix→result mapping.
- **[DECISION 11.1 — future, out of scope]** Voicemail-drop (Telnyx `playback_start` of a
  recorded message on machine detection) is **deferred**; Phase 4 hangs up + logs, matching
  legacy. Revisit if sales wants automated VM messages (needs audio-asset storage + consent
  posture, handover §11).
- **[DECISION 11.2]** Whether `call_events.payload` stores the **full** Telnyx payload (richer
  audit, larger rows) or a **trimmed** subset. Default: trimmed to the fields the reducer +
  reporting need, with the raw body discarded after verification. Confirm.
