# Phase 4 — AMD Dialler "Mode B" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship server-orchestrated answering-machine-detection dialling ("Mode B") behind the Phase-3 dialler seam, fully runnable and testable locally against a mock Telnyx backend with no Telnyx account.

**Architecture:** A Next.js Route Handler (`app/api/telnyx/webhook`) receives Telnyx call webhooks; Server Actions place/hang-up/bridge calls server-side. Call state lives in three org-scoped Postgres tables (`call_runs`/`call_attempts`/`call_events`) published to Supabase Realtime, which streams transitions to the browser. A pure event→state reducer + Ed25519 verifier + AMD config live in `lib/dialler/amd/` and are shared by the real webhook path and an in-process `MockTelnyxBackend` (gated like dev mock-auth). See `docs/PHASE_4_SPEC.md` and ADR 006.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Supabase (Postgres + RLS + Realtime), Vitest, Playwright, Zod.

**Spec reference:** `docs/PHASE_4_SPEC.md` is authoritative for behaviour; section numbers (§N) below point at it. This plan is the build order; the spec carries the exhaustive rules (touchpoint discipline §4, AMD config §5, state table §3).

---

## Conventions for every task

- **Branch:** all work on `feat/phase-4-amd-dialler` (off `main`). Never push to `main`.
- **Imports:** `@/*` alias only (no `../../..`). TS strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `noImplicitOverride`.
- **Error classes:** forward `cause` to native `Error` option (ADR 003); no `@ts-ignore`.
- **Per-task verify gate (run before each commit):** `make typecheck && make lint && make test`. Migrations also run `supabase db reset`. Commit messages: Conventional Commits, no `Co-Authored-By` line.
- **No `Math.random()` / `Date.now()` in pure logic** — pass timestamps/scenario in (repo rule; mirrors `lib/dialler/mock.ts`).

---

## File structure (what each new/changed file owns)

| Path | Responsibility |
|---|---|
| `supabase/migrations/20260531120000_phase4_dialler_amd.sql` | `call_attempt_state` enum; `call_runs`/`call_attempts`/`call_events` tables, indexes, RLS, Realtime publication (spec §2). |
| `lib/dialler/amd/types.ts` | TS shapes: `CallAttemptState` union, `AmdResult`, `TelnyxEvent`, `CallAttempt`/`CallRun`/`CallEvent` row+domain types, `AmdScenario`. |
| `lib/dialler/amd/config.ts` | `buildDialPayload()` — AMD Call-Control dial body (spec §5, worker.js L86–97). Pure. |
| `lib/dialler/amd/reducer.ts` | `reduceEvent(attempt, event)` → `{ nextState, disposition?, sideEffects[] }` (spec §3/§4). Pure, no I/O. |
| `lib/dialler/amd/verify.ts` | `verifyTelnyxSignature(rawBody, sigHeaders, publicKey, now)` Ed25519 (spec §6). Pure. |
| `lib/dialler/amd/backend.ts` | `AmdDiallerBackend` interface + `getAmdBackend()` factory (spec §5). |
| `lib/dialler/amd/telnyx-backend.ts` | `TelnyxAmdBackend` — real Call-Control API (spec §6). |
| `lib/dialler/amd/mock-backend.ts` | `MockTelnyxBackend` — schedules the lifecycle on timers into the reducer (spec §7). |
| `lib/dialler/amd/apply.ts` | `applyEvent(supabaseServiceClient, attemptId, event)` — runs `reduceEvent`, persists attempt/event/touchpoint via service role (spec §3/§4). The one server write path. |
| `lib/env.ts` (modify) | `isDiallerMockEnabled()`; Telnyx server-env schema (`TELNYX_API_KEY`, `TELNYX_CONNECTION_ID`, `TELNYX_PUBLIC_KEY`, `BRIDGE_SIP_USERNAME`, `AMD_MODE`, `NO_ANSWER_TIMEOUT_MS`, `DIALLER_MOCK_ENABLED`). |
| `lib/supabase/service.ts` (modify/confirm) | Service-role client factory (confirm it exists; add if not). |
| `lib/actions/dialler-amd.ts` | `startAmdRun`, `placeAmdCall`, `hangupAttempt`, `cancelAttempt`, `setRunStatus` Server Actions (spec §1/§8). |
| `app/api/telnyx/webhook/route.ts` | Public webhook: verify → `applyEvent` (spec §6). |
| `app/dialler/amd/*` (UI) | "Start AMD Run", Realtime-driven live queue, human hand-off to the Phase-3 panel (spec §8). |
| `lib/dialler/amd/realtime.ts` | Client hook `useAmdRun(runId)` subscribing to `call_attempts`/`call_events` for the run. |
| `tests/unit/dialler/amd-*.test.ts`, `tests/e2e/amd-run.spec.ts` | Per spec §9. |

---

## Task 1: Migration — call tables, enum, RLS, Realtime

**Files:**
- Create: `supabase/migrations/20260531120000_phase4_dialler_amd.sql`
- Test: `tests/unit/dialler/amd-migration.test.ts` (schema assertions via a queries helper) — OR validate via `supabase db reset` (primary gate).

- [ ] **Step 1: Write the migration** per spec §2 exactly — `create type public.call_attempt_state as enum ('queued','dialing','ringing','answered','amd_pending','machine','bridged','ended','failed')`; the three tables with denormalised `org_id`, FKs, indexes (incl. unique `call_control_id` where not null), `set_updated_at()` triggers on `call_runs`/`call_attempts`; RLS per §2.4 (SELECT+INSERT for org; `call_events` append-only — no UPDATE/DELETE policy; client UPDATE on `call_runs.status` + attempt cancel only); and `alter publication supabase_realtime add table public.call_runs, public.call_attempts, public.call_events;`.

- [ ] **Step 2: Apply and verify** — Run: `supabase db reset`. Expected: completes with no error; the new objects exist. Spot-check: `supabase db reset 2>&1 | grep -i error` returns nothing.

- [ ] **Step 3: Verify RLS + publication** via psql against the local stack: `select policyname from pg_policies where tablename in ('call_runs','call_attempts','call_events');` (expect SELECT/INSERT policies, no UPDATE/DELETE on call_events) and `select tablename from pg_publication_tables where pubname='supabase_realtime' and tablename like 'call_%';` (expect 3 rows).

- [ ] **Step 4: Commit** — `git commit -m "feat(phase-4): call_runs/attempts/events schema, RLS, realtime publication"`.

---

## Task 2: AMD domain types

**Files:**
- Create: `lib/dialler/amd/types.ts`
- Test: (types are exercised by later tasks; no standalone test)

- [ ] **Step 1: Define types** mirroring spec §2/§3: `CallAttemptState` union = the enum members; `AmdResult = 'human'|'machine'|'not_sure'|'fax'|'human_residence'`; `AmdScenario = 'human'|'machine'|'no-answer'|'fail'`; `TelnyxEventType` union (`call.initiated`/`call.ringing`/`call.answered`/`call.machine.detection.ended`/`call.hangup`); `TelnyxEvent` (`{ eventType; callControlId; result?; hangupCause?; customHeaders? }`); `CallAttempt`/`CallRun`/`CallEvent` domain shapes (camelCase, matching the domain.ts convention) + their snake_case `*Row` shapes. Add `AmdBackendError extends Error` forwarding `cause` (ADR 003).

- [ ] **Step 2: Typecheck** — Run: `make typecheck`. Expected: PASS.

- [ ] **Step 3: Commit** — `git commit -m "feat(phase-4): AMD domain + Telnyx event types"`.

---

## Task 3: AMD dial-payload config (pure)

**Files:**
- Create: `lib/dialler/amd/config.ts`
- Test: `tests/unit/dialler/amd-config.test.ts`

- [ ] **Step 1: Write the failing test** — assert `buildDialPayload({ to:'+447700900001', from:'+441234567890', connectionId:'cc1', attemptId:'a1', runId:'r1', contactId:'c1', amdMode:'premium', noAnswerMs:22000 })` returns an object with `answering_machine_detection: 'premium'`, the full `answering_machine_detection_config` block (values from spec §5 / worker.js L86–97), `timeout_secs: 22`, and `custom_headers` containing `X-Hub-Attempt-Id=a1`, `X-Hub-Run-Id=r1`, `X-Hub-Contact-Id=c1`.

- [ ] **Step 2: Run test → fail** — Run: `pnpm vitest run tests/unit/dialler/amd-config.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `buildDialPayload`** as a pure function per spec §5; `timeout_secs = Math.ceil(noAnswerMs/1000)`.

- [ ] **Step 4: Run test → pass** — Run: `pnpm vitest run tests/unit/dialler/amd-config.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(phase-4): AMD dial-payload builder"`.

---

## Task 4: Event→state reducer (pure, the behavioural core)

**Files:**
- Create: `lib/dialler/amd/reducer.ts`
- Test: `tests/unit/dialler/amd-reducer.test.ts`

- [ ] **Step 1: Write failing tests** covering every spec §3 transition and §4 disposition/side-effect:
  - `call.initiated` from `queued`/`dialing` → `dialing`; `call.ringing` → `ringing`; `call.answered` → `answered` (NO bridge side-effect yet); the gap → `amd_pending`.
  - `call.machine.detection.ended` result `machine`/`fax` → state `machine`, side-effects `['hangup','log-vm-touchpoint']`, disposition pending.
  - result `human`/`not_sure`/`human_residence` → state `bridged`, side-effect `['bridge']`, NO touchpoint.
  - `call.hangup` after machine → `ended`, disposition `voicemail-auto`; after bridge → `ended`, disposition `bridged-human`; after only ringing (never answered) → `ended`, disposition `no-answer`, NO touchpoint side-effect.
  - Each assertion checks `{ nextState, disposition, sideEffects }` shape.

- [ ] **Step 2: Run → fail** — Run: `pnpm vitest run tests/unit/dialler/amd-reducer.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `reduceEvent(attempt, event)`** as a pure switch on `event.eventType` (and `attempt.state`/`attempt.amdResult` for the hangup-disposition branch), returning `{ nextState, disposition?, amdResult?, sideEffects: SideEffect[] }` where `SideEffect = 'hangup'|'bridge'|'log-vm-touchpoint'`. No I/O, no clock.

- [ ] **Step 4: Run → pass** — Run: `pnpm vitest run tests/unit/dialler/amd-reducer.test.ts`. Expected: PASS (all branches).

- [ ] **Step 5: Commit** — `git commit -m "feat(phase-4): AMD event->state reducer with disposition rules"`.

---

## Task 5: Ed25519 webhook verification (pure)

**Files:**
- Create: `lib/dialler/amd/verify.ts`
- Test: `tests/unit/dialler/amd-verify.test.ts`

- [ ] **Step 1: Write failing tests** using a fixed test keypair generated in-test via `crypto.generateKeyPairSync('ed25519')`: sign `"<timestamp>|<rawBody>"`, assert `verifyTelnyxSignature` returns `true` for a valid signature; `false` for a tampered body; `false` for a stale timestamp (older than the tolerance, default 5 min — pass `now` explicitly, no `Date.now()` in the function); `false` for a wrong key.

- [ ] **Step 2: Run → fail** — Run: `pnpm vitest run tests/unit/dialler/amd-verify.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `verifyTelnyxSignature(rawBody, { signature, timestamp }, publicKeyBase64, now, toleranceSec=300)`** using Node `crypto.verify('ed25519', Buffer.from(`${timestamp}|${rawBody}`), publicKey, sigBuffer)` + timestamp-freshness check against `now`.

- [ ] **Step 4: Run → pass** — Run: `pnpm vitest run tests/unit/dialler/amd-verify.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(phase-4): Ed25519 Telnyx webhook verification"`.

---

## Task 6: env gate + Telnyx server-env schema

**Files:**
- Modify: `lib/env.ts`
- Test: `tests/unit/env-dialler-mock.test.ts`

- [ ] **Step 1: Write failing tests** for `isDiallerMockEnabled(env)` mirroring the existing `isAuthMockEnabled` tests: true only when `NODE_ENV !== 'production'` AND `DIALLER_MOCK_ENABLED==='true'` AND `NEXT_PUBLIC_SUPABASE_URL` is loopback; false if any condition fails (incl. a `*.supabase.co` URL with the flag set).

- [ ] **Step 2: Run → fail** — Run: `pnpm vitest run tests/unit/env-dialler-mock.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `isDiallerMockEnabled` reusing `isLocalSupabaseUrl`; extend `serverEnvSchema` with the optional Telnyx vars (all `z.preprocess(emptyStringAsUndefined, z.string().min(1).optional())` except `AMD_MODE` default `'premium'`, `NO_ANSWER_TIMEOUT_MS` coerced number default 22000, `DIALLER_MOCK_ENABLED`).

- [ ] **Step 4: Run → pass + full gate** — Run: `pnpm vitest run tests/unit/env-dialler-mock.test.ts && make typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(phase-4): dialler mock gate + Telnyx server-env schema"`.

---

## Task 7: Service-role client + `applyEvent` persistence

**Files:**
- Modify/confirm: `lib/supabase/service.ts` (service-role client; create if absent following `lib/supabase/server.ts` patterns)
- Create: `lib/dialler/amd/apply.ts`
- Test: `tests/unit/dialler/amd-apply.test.ts` (with an in-memory fake Supabase client)

- [ ] **Step 1: Write failing tests** — given a fake service client capturing writes, `applyEvent(client, attempt, event)`:
  - persists the new `call_attempts.state`/`amd_result`/`disposition`/`hangup_cause`/`ended_at` from `reduceEvent`;
  - inserts one `call_events` row (event_type + trimmed payload, per DECISION 11.2 default);
  - on a `log-vm-touchpoint` side-effect inserts exactly one `touchpoints` row (`channel:'phone'`, `note:'Voicemail reached — auto'`, `org_id` from attempt) — and NONE otherwise;
  - returns the side-effects (`hangup`/`bridge`) for the caller to actuate.

- [ ] **Step 2: Run → fail** — Run: `pnpm vitest run tests/unit/dialler/amd-apply.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `applyEvent`** = call `reduceEvent`, then issue the attempt UPDATE + `call_events` INSERT + conditional touchpoint INSERT through the passed client; return the actuation side-effects. Confirm/author `lib/supabase/service.ts` exporting a service-role client (uses `SUPABASE_SERVICE_ROLE_KEY` + server URL).

- [ ] **Step 4: Run → pass** — Run: `pnpm vitest run tests/unit/dialler/amd-apply.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(phase-4): applyEvent persistence (attempt/event/auto-VM touchpoint)"`.

---

## Task 8: Backend interface + mock backend

**Files:**
- Create: `lib/dialler/amd/backend.ts`, `lib/dialler/amd/mock-backend.ts`
- Test: `tests/unit/dialler/amd-mock-backend.test.ts`

- [ ] **Step 1: Write failing tests** (vitest fake timers): `MockTelnyxBackend.placeCall({...,scenario:'machine'})` then advancing timers drives `applyEvent` through `dialing→ringing→answered→amd_pending→machine→ended` with disposition `voicemail-auto` and one auto-VM touchpoint; `scenario:'human'` ends `bridged-human` with a `bridge` actuation and no touchpoint; `scenario:'no-answer'` ends `no-answer` with no touchpoint; `scenario:'fail'` → `failed`. Scenario also derivable from number suffix per DECISION 7.1 (`…0001`=human/`0002`=machine/`0003`=no-answer) — test both the explicit override and the suffix mapping.

- [ ] **Step 2: Run → fail** — Run: `pnpm vitest run tests/unit/dialler/amd-mock-backend.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `AmdDiallerBackend` interface (spec §5: `placeCall`/`hangup`/`bridge`) + `MockTelnyxBackend` scheduling synthetic `TelnyxEvent`s on `setTimeout` into `applyEvent` (inject the client + a clock for the disposition timestamps); `getAmdBackend()` factory returning mock when `isDiallerMockEnabled()` else `TelnyxAmdBackend`.

- [ ] **Step 4: Run → pass** — Run: `pnpm vitest run tests/unit/dialler/amd-mock-backend.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(phase-4): AMD backend interface + in-process mock Telnyx backend"`.

---

## Task 9: Real Telnyx backend (structurally complete)

**Files:**
- Create: `lib/dialler/amd/telnyx-backend.ts`
- Test: `tests/unit/dialler/amd-telnyx-backend.test.ts` (mock `fetch`)

- [ ] **Step 1: Write failing tests** with a stubbed `fetch`: `placeCall` POSTs `https://api.telnyx.com/v2/calls` with the `buildDialPayload` body + bearer `TELNYX_API_KEY`, returns `call_control_id` from the response; `hangup` POSTs `/v2/calls/{id}/actions/hangup`; `bridge` POSTs `/v2/calls/{id}/actions/transfer` with `to: sip:${BRIDGE_SIP_USERNAME}@sip.telnyx.com`. Assert a non-ok response throws `AmdBackendError`.

- [ ] **Step 2: Run → fail** — Run: `pnpm vitest run tests/unit/dialler/amd-telnyx-backend.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `TelnyxAmdBackend`** per spec §6 (worker.js L360–370 `telnyxAPI` shape; L278–293 transfer). No real network in tests.

- [ ] **Step 4: Run → pass** — Run: `pnpm vitest run tests/unit/dialler/amd-telnyx-backend.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(phase-4): real Telnyx Call-Control backend"`.

---

## Task 10: Server Actions (startAmdRun / placeAmdCall / hangup / cancel / setRunStatus)

**Files:**
- Create: `lib/actions/dialler-amd.ts`
- Test: `tests/unit/dialler/amd-actions.test.ts` (mock `@/lib/supabase/server` + `getCurrentOrgId` + backend, as existing action tests do)

- [ ] **Step 1: Write failing tests** — `startAmdRun()` inserts a `call_runs` row (org-scoped, `created_by`); `placeAmdCall(runId, contactId)` resolves the dial number via `pickDialNumber`/`normalisePhone` (reuse Phase-3 `lib/dialler/normalise.ts`), inserts a `queued` `call_attempts` row, calls `backend.placeCall`, stores `call_control_id`; rejects a non-dialable contact; enforces the sequential invariant (refuses a 2nd non-terminal attempt in the same active run); `hangupAttempt`/`cancelAttempt`/`setRunStatus` update the right rows + revalidate `/dialler`.

- [ ] **Step 2: Run → fail** — Run: `pnpm vitest run tests/unit/dialler/amd-actions.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the actions (`'use server'`) mirroring `lib/actions/dialler.ts` conventions (zod inputs, `getCurrentOrgId`, RLS-scoped client for inserts the rep owns, `getAmdBackend()` for the call control, `revalidatePath`).

- [ ] **Step 4: Run → pass** — Run: `pnpm vitest run tests/unit/dialler/amd-actions.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(phase-4): AMD run/place/hangup/cancel server actions"`.

---

## Task 11: Webhook route handler

**Files:**
- Create: `app/api/telnyx/webhook/route.ts`
- Test: `tests/unit/dialler/amd-webhook-route.test.ts`

- [ ] **Step 1: Write failing tests** — POST with a valid Ed25519-signed body (test keypair via `TELNYX_PUBLIC_KEY`) parses the Telnyx envelope into a `TelnyxEvent`, loads the attempt by `call_control_id` (or recovers ids from `custom_headers`), calls `applyEvent`, actuates `hangup`/`bridge` on the backend, and returns 200; an invalid signature returns 401 and does NOT write; when `TELNYX_PUBLIC_KEY` is unset + `isDiallerMockEnabled()` the route accepts mock-tagged events (per DECISION 6.1) and otherwise rejects unsigned.

- [ ] **Step 2: Run → fail** — Run: `pnpm vitest run tests/unit/dialler/amd-webhook-route.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the `POST` handler (Node runtime — `export const runtime = 'nodejs'`): read raw body, verify (§6 + DECISION 6.1 gate), map Telnyx payload → `TelnyxEvent` (worker.js L165–274 field names), `applyEvent` via the service client, actuate side-effects, always 200 on accepted/handled, 401 on bad signature.

- [ ] **Step 4: Run → pass** — Run: `pnpm vitest run tests/unit/dialler/amd-webhook-route.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(phase-4): Telnyx webhook route (verify -> applyEvent -> actuate)"`.

---

## Task 12: Realtime client hook

**Files:**
- Create: `lib/dialler/amd/realtime.ts`
- Test: covered by the e2e walk-through (Task 14); add a thin unit test if the subscription mapping has logic worth isolating.

- [ ] **Step 1: Implement `useAmdRun(runId)`** (`'use client'`) — subscribes to `postgres_changes` on `call_attempts`/`call_events` filtered `run_id=eq.<runId>` via the browser Supabase client, returns the live attempts keyed by id + the latest event, unsubscribing on unmount (mirror the unmount-safety lessons from the Phase-3 click-to-call fix).

- [ ] **Step 2: Typecheck/lint** — Run: `make typecheck && make lint`. Expected: PASS.

- [ ] **Step 3: Commit** — `git commit -m "feat(phase-4): useAmdRun realtime subscription hook"`.

---

## Task 13: AMD-run UI + human hand-off

**Files:**
- Create: `app/dialler/amd/page.tsx` + components under `app/dialler/amd/`
- Modify: `app/dialler/page.tsx` (add the "Start AMD Run" entry alongside Phase-3 "Start run")

- [ ] **Step 1: Implement the run UI** (spec §8): contact picker reusing the Phase-3 queue/filters (default-exclude `notinterested`/`bounced`); "Start AMD Run" → `startAmdRun` then `placeAmdCall` per queued contact (sequential); live per-attempt state from `useAmdRun` (dialing/ringing/answered/"AMD analysing…"/machine→"Voicemail — auto-logged"/human→"Connecting you…"); per-run tallies; Hang up / Skip / Pause-Stop controls; a mock/telnyx backend pill.

- [ ] **Step 2: Implement human hand-off** — on a `bridged` transition, open the **existing Phase-3 click-to-call panel** for the contact so the rep logs an outcome via `logCallOutcome`; on resolution, auto-advance to the next queued attempt with the Phase-3 `txCallDelay` pacing.

- [ ] **Step 3: Verify build** — Run: `make typecheck && make lint && make build`. Expected: PASS.

- [ ] **Step 4: Commit** — `git commit -m "feat(phase-4): AMD run UI with realtime status + human hand-off"`.

---

## Task 14: End-to-end walk-through (mock) + final gate

**Files:**
- Create: `tests/e2e/amd-run.spec.ts`

- [ ] **Step 1: Write the Playwright spec** — with `AUTH_MOCK_ENABLED=true` + `DIALLER_MOCK_ENABLED=true` on the local stack: sign in via `/auth/mock`; start an AMD run over a small seeded queue containing a `…0002` (machine) and a `…0001` (human) number; assert the machine attempt reaches "Voicemail — auto-logged" and the contact gains exactly one `phone` touchpoint `Voicemail reached — auto`; assert the human attempt reaches `bridged`, opens the click-to-call panel, and logging an outcome writes the rep's touchpoint; assert a `…0003` attempt ends no-answer with no touchpoint.

- [ ] **Step 2: Run e2e** — Run: `make test-e2e` (boots the stack). Expected: PASS.

- [ ] **Step 3: Full validation gate** — Run: `supabase db reset && make typecheck && make lint && make test && make build`. Expected: all green. Then a manual `/auth/mock` walk-through of an AMD run to confirm live Realtime updates in the browser.

- [ ] **Step 4: Commit** — `git commit -m "test(phase-4): e2e AMD run walk-through via mock backend"`.

---

## Task 15: Status doc + PR

- [ ] **Step 1: Update `PHASE_0_STATUS.md`** (or the running status doc) noting Phase 4 landed, mock-only locally, real Telnyx gated on credentials.

- [ ] **Step 2: Open the PR** — `gh pr create` from `feat/phase-4-amd-dialler` into `main` with a summary linking `docs/PHASE_4_SPEC.md` + ADR 006. Then run the Copilot review loop (`/copilot-review` via `/loop`) until clean.

- [ ] **Step 3: Commit any review fixes** as `fix(phase-4): …` and re-run the full gate before merge.

---

## Self-review notes (author check against spec)

- **Spec coverage:** §1 (Tasks 10/11/12), §2 (Task 1), §3 (Task 4), §4 touchpoint discipline (Tasks 4+7), §5 (Tasks 3+8), §6 verify+real path (Tasks 5+9+11), §7 mock (Task 8), §8 UI (Task 13), §9 file/test inventory (all tasks), §10 acceptance (Task 14 gate). All covered.
- **DECISIONS:** 4.1 server-side writes (Tasks 7/10/RLS), 5.1 Server-Action dial (Task 10), 6.1 verify gate (Task 11), 7.1 deterministic mock scenario (Task 8), 11.2 trimmed payload (Task 7). Covered.
- **Type consistency:** `reduceEvent` returns `{nextState,disposition?,amdResult?,sideEffects}` used identically in Tasks 4/7/8/11; `SideEffect`='hangup'|'bridge'|'log-vm-touchpoint'; `AmdScenario`='human'|'machine'|'no-answer'|'fail'.
