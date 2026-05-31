# Phase 5 — Email Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the email engine — a sequence-aware send runner + reply/bounce scanner behind the `EmailDriver` seam — fully runnable/testable locally on the `mock` driver with no Microsoft Graph consent.

**Architecture:** Pure cores (`renderTemplate`, `businessDayAdd`/next-step, `classifyInbound`) are unit-tested in isolation. `runSender`/`scanInbox` orchestrate over an injected `EmailStore` (DB writes) + the `EmailDriver`, so they're testable with fakes; a Supabase adapter backs them in production. Server Actions (manual "Run now"/"Scan now", enrol, suppressions) and `CRON_SECRET`-gated Next routes both call the same cores (ADR 006 precedent: Next routes, not Edge Functions). New schema: `campaigns.sequence_id`, `contacts.last_emailed_at`, `email_events` (append-only audit + dedup), `suppressions` (address-level do-not-send). See `docs/PHASE_5_SPEC.md`.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Supabase (Postgres + RLS), Vitest, Playwright, Zod, nodemailer (mailpit).

**Spec reference:** `docs/PHASE_5_SPEC.md` is authoritative; §N below point at it.

---

## Conventions (every task)

- **Branch:** `feat/phase-5-email-runner` (off `main`, which now has Phases 0–4). Never push to `main`.
- `@/*` imports; TS strict (+ `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`); forward `cause` to `Error` (ADR 003); no `@ts-ignore`.
- **No `Math.random()` / `Date.now()` in pure logic** — pass `today`/clock in (repo rule).
- **Per-task gate before commit:** `pnpm typecheck` (check exit 0, not via `&&` after a pipe) + `pnpm lint` (0 errors) + relevant `pnpm vitest run`. Migrations also `make db-reset`. Conventional Commits, **no Co-Authored-By line**.
- **Reuse, don't duplicate:** compose the existing Phase-2 `logTouchpoint` / `setContactStatus` / `updateContact` (`lib/actions/contacts.ts`) and `resolveStatusEffect` (`lib/dialler/outcomes.ts`) for status precedence (spec §8).

---

## File structure

| Path | Responsibility |
|---|---|
| `supabase/migrations/20260531130000_phase5_email_runner.sql` | `campaigns.sequence_id` FK; `contacts.last_emailed_at`; `email_events` + `suppressions` tables/indexes/RLS (§2). |
| `lib/email/types.ts` (modify) | Add `EmailEventType`, `SuppressionReason`, `EmailEvent`/`Suppression` domain + row shapes. |
| `lib/email/render.ts` | `renderTemplate(template, contact, settings)` — pure (§3). |
| `lib/email/schedule.ts` | `businessDayAdd(date, n, skipWeekends)` + `nextStep`/`currentStep` resolution — pure (§4). |
| `lib/email/classify.ts` | `classifyInbound(msg): 'reply'|'bounce'|'ignore'` — pure (§7). |
| `lib/email/store.ts` | `EmailStore` interface (DB surface the runner/scanner need) + `supabaseEmailStore(client)` adapter + row mappers. |
| `lib/email/runner.ts` | `runSender(deps, opts)` core (§5). |
| `lib/email/scanner.ts` | `scanInbox(deps, opts)` core (§6/§7). |
| `lib/email/mock.ts` (modify) | reply/bounce simulator helpers (§9). |
| `lib/email/mailpit.ts` (modify) | implement `fetchReplies` via Mailpit REST (§9). |
| `lib/email/graph.ts` (modify) | implement `send` + `fetchReplies` (§9). |
| `lib/env.ts` (modify) | `isEmailMockEnabled()`, `CRON_SECRET` schema. |
| `lib/actions/email.ts` | `runSenderNow`/`scanInboxNow`/`enrolInSequence`/`setCampaignSequence`/`addSuppression`/`removeSuppression` (§8/§10). |
| `app/api/email/run/route.ts`, `app/api/email/scan/route.ts` | `CRON_SECRET`-gated triggers (§1). |
| `app/queue/`, `app/sequences/` additions, suppressions admin | UI (§10). |
| `tests/unit/email/*.test.ts`, `tests/e2e/email-runner.spec.ts` | per §11. |

---

## Task 1: Migration — sequence link, email_events, suppressions

**Files:** Create `supabase/migrations/20260531130000_phase5_email_runner.sql`

- [ ] **Step 1: Write the migration** per spec §2: `alter table public.campaigns add column sequence_id uuid references public.sequences(id) on delete set null` + index; `alter table public.contacts add column last_emailed_at timestamptz`; `create table public.email_events` (cols §2.3; `org_id`/`contact_id`/`campaign_id` FKs; `type`/`provider`/`message_id`/`conversation_id`/`in_reply_to`/`subject`/`sequence_day`/`occurred_at`/`payload jsonb default '{}'`/`created_at`); `create table public.suppressions` (cols §2.4); indexes incl. `email_events (org_id, type, occurred_at)`, `(contact_id)`, unique `(org_id, provider, message_id) where message_id is not null`, and unique `suppressions (org_id, lower(email))`; RLS §2.5 — SELECT+INSERT org-scoped on both; `email_events` no UPDATE/DELETE; `suppressions` allows DELETE; org-scoped.

- [ ] **Step 2: Apply** — Run: `make db-reset`. Expected: applies cleanly, no error.

- [ ] **Step 3: Verify** (psql in `supabase_db_outreach-hub`): `campaigns.sequence_id` + `contacts.last_emailed_at` columns exist; the two unique indexes exist; `email_events` has only SELECT/INSERT policies; `suppressions` has SELECT/INSERT/DELETE.

- [ ] **Step 4: Commit** — `feat(phase-5): email_events + suppressions schema, campaign sequence link, RLS`.

---

## Task 2: Email domain types

**Files:** Modify `lib/email/types.ts`

- [ ] **Step 1: Add types** — `EmailEventType = 'sent'|'reply'|'bounce'`; `SuppressionReason = 'replied'|'bounced'|'manual'|'unsubscribed'`; `EmailEvent`/`Suppression` camelCase domain shapes + snake_case `*Row`. Keep existing `OutboundMessage`/`InboundMessage`/`SentRef` unchanged.

- [ ] **Step 2: Typecheck** — `pnpm typecheck` exit 0.

- [ ] **Step 3: Commit** — `feat(phase-5): email-event + suppression domain types`.

---

## Task 3: `renderTemplate` (pure)

**Files:** Create `lib/email/render.ts`, `tests/unit/email/render.test.ts`

- [ ] **Step 1: Failing test** — `renderTemplate({subject:'Hi {firstName}', body:'{firstName} at {company}\n{signature}'}, contact, settings)`: substitutes `{firstName}`/`{lastName}`/`{company}`/`{jobTitle}` from the contact and `{signature}` from `settings.signature`; a missing known field (null) → empty string; an unknown token `{foo}` → left verbatim (DECISION 3.1). Assert both subject and body.

- [ ] **Step 2: Run → fail** — `pnpm vitest run tests/unit/email/render.test.ts`.

- [ ] **Step 3: Implement** `renderTemplate(template: {subject:string|null; body:string|null}, contact, settings): {subject:string; body:string}` — a single pass replacing the known token set; unknown `{...}` untouched. Pure.

- [ ] **Step 4: Run → pass.** Commit — `feat(phase-5): template merge-field rendering`.

---

## Task 4: `businessDayAdd` + step resolution (pure)

**Files:** Create `lib/email/schedule.ts`, `tests/unit/email/schedule.test.ts`

- [ ] **Step 1: Failing test** with fixed dates: `businessDayAdd('2026-05-29' (Fri), 1, true)` → `'2026-06-01'` (Mon, weekend rolled); `(…, 1, false)` → `'2026-05-30'` (Sat); `(…, 3, true)` → skips the weekend. `currentStep(steps, dayOffset)` returns the step with that `day_offset`; `nextStep(steps, dayOffset)` returns the step with the smallest `day_offset` greater than it, or null at the end. Steps sorted by `day_offset`.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** `businessDayAdd(isoDate, n, skipWeekends)` (operate on UTC date parts, return `YYYY-MM-DD`; when skipWeekends, roll a Sat→Mon (+2) / Sun→Mon (+1) landing) + `currentStep`/`nextStep` over `SequenceStep[]`. Pure; caller passes the anchor date.

- [ ] **Step 4: Run → pass.** Commit — `feat(phase-5): business-day follow-up scheduling + step resolution`.

---

## Task 5: `classifyInbound` (pure)

**Files:** Create `lib/email/classify.ts`, `tests/unit/email/classify.test.ts`

- [ ] **Step 1: Failing test** — `classifyInbound(msg)`: a normal reply (`from: prospect@x.com`, has `inReplyTo`/`conversationId`) → `'reply'`; an NDR (`from: postmaster@…` / `mailer-daemon@…`, or subject `Undeliverable`/`Delivery Status Notification`) → `'bounce'`; an unrelated marketing mail (no inReplyTo, non-system sender) → `'ignore'` only if it can't be correlated (classification is sender/subject-based; correlation is the scanner's job — keep `classifyInbound` to bounce-vs-reply, returning `'reply'` for an ordinary inbound). DECISION 7.1.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** `classifyInbound(msg: InboundMessage): 'reply'|'bounce'` — `'bounce'` when the sender local-part/domain is a system address (`postmaster`, `mailer-daemon`, `no-reply`-style NDR) OR the subject matches the NDR set (`/undeliverable|delivery status notification|mail delivery failed|returned mail/i`); else `'reply'`. (The scanner decides `ignore` when no contact correlates — §6.) Pure.

- [ ] **Step 4: Run → pass.** Commit — `feat(phase-5): inbound reply-vs-bounce classification`.

---

## Task 6: env gate + CRON_SECRET

**Files:** Modify `lib/env.ts`; create `tests/unit/email/env-email-mock.test.ts`

- [ ] **Step 1: Failing test** — `isEmailMockEnabled(env)` true only when `NODE_ENV!=='production'` AND `EMAIL_DRIVER` is `mock` (only — NOT `mailpit`; the simulator writes to the process-global dev inbox that only `MockDriver.fetchReplies` drains, whereas Mailpit scans its real REST API) AND loopback `NEXT_PUBLIC_SUPABASE_URL`; false otherwise. `parseServerEnv` accepts an optional `CRON_SECRET`.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** `isEmailMockEnabled` (reuse `isLocalSupabaseUrl`) + add `CRON_SECRET: z.preprocess(emptyStringAsUndefined, z.string().min(1).optional())` to `serverEnvSchema`.

- [ ] **Step 4: Run → pass + `pnpm typecheck`.** Commit — `feat(phase-5): email mock gate + CRON_SECRET env`.

---

## Task 7: `EmailStore` + Supabase adapter

**Files:** Create `lib/email/store.ts`; `tests/unit/email/store-fake.ts` (test helper — an in-memory `EmailStore`)

- [ ] **Step 1: Define `EmailStore`** — the DB surface the runner/scanner need, all org-scoped by the caller:
  - `dueContacts(today: string): Promise<DueContact[]>` — eligible+enrolled+non-suppressed contacts (§5 selection) with their campaign's sequence steps resolved.
  - `sentCountToday(today: string): Promise<number>` (cap accounting).
  - `recordSent(row): Promise<void>` — insert `email_events(sent)` (dedup on (org,provider,message_id)), upsert touchpoint (`Sent: <subject>`, dedup legacy key), set `contacts.last_emailed_at` + advance `sequence_day`/`follow_up`.
  - `recordInbound(row): Promise<{ deduped: boolean }>` — insert `email_events(reply|bounce)` (dedup on message_id), apply status (`setContactStatus`), insert `suppressions`, append touchpoint.
  - `findSentForCorrelation(keys): Promise<{contactId; campaignId}|null>` — match inbound to a prior `sent` (conversationId/inReplyTo/sender).
  - `lastScanHighWater(): Promise<string|null>`.

- [ ] **Step 2: Implement `supabaseEmailStore(client)`** mapping to the tables; reuse the dedup keys (touchpoint `legacy_id = email-sent-<eventId>` etc.). No standalone unit test (exercised by runner/scanner tests via the fake + by e2e). `pnpm typecheck`.

- [ ] **Step 3: Commit** — `feat(phase-5): EmailStore abstraction + Supabase adapter`.

---

## Task 8: `runSender` core

**Files:** Create `lib/email/runner.ts`, `tests/unit/email/runner.test.ts`

- [ ] **Step 1: Failing tests** (fake `EmailStore` + `MockDriver`): selects only eligible/enrolled/due contacts; renders + `driver.send` per contact; on success calls `store.recordSent` once; respects the daily cap (`min(limit, dailyGoal) - sentToday`) and reports the remainder (no silent truncation); `dryRun` returns the `planned` list and sends/writes nothing; a `driver.send` throw is captured in `errors` and does NOT abort the batch or advance that contact; weekend no-op when `seqSkipWeekends` + `today` is Sat/Sun.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** `runSender({store, driver, settings, now}, {dryRun?, limit?, today?})` → `{planned, sent, skipped, errors, remaining}`. Pure-ish orchestration; the clock/today injected.

- [ ] **Step 4: Run → pass.** Commit — `feat(phase-5): send runner (selection, cap, dry-run, error isolation)`.

---

## Task 9: `scanInbox` core

**Files:** Create `lib/email/scanner.ts`, `tests/unit/email/scanner.test.ts`

- [ ] **Step 1: Failing tests** (fake store + `MockDriver.inbound`): a correlated reply → `classifyInbound`→reply → `store.recordInbound(reply)` (green + suppress + touchpoint); a correlated NDR → bounce → recordInbound(bounce) (bounced + suppress); an uncorrelated inbound → ignored; a duplicate (same message_id) → deduped (recordInbound reports deduped, no second effect); `since` defaults to the store high-water mark.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** `scanInbox({store, driver}, {since?})` → `{replies, bounces, ignored}` — `driver.fetchReplies({since})` → per message: correlate (store.findSentForCorrelation) → if none, ignore → else `classifyInbound` → `store.recordInbound`.

- [ ] **Step 4: Run → pass.** Commit — `feat(phase-5): inbox scanner (correlate, classify, effects, dedup)`.

---

## Task 10: Extend MockDriver (reply/bounce simulator)

**Files:** Modify `lib/email/mock.ts`, `tests/unit/email/mock.test.ts`

- [ ] **Step 1: Failing test** — `mock.simulateReply(messageId|{to,from})` enqueues an inbound reply into `inbound` so a later `fetchReplies({since})` returns it; `mock.simulateBounce(...)` enqueues an NDR-shaped inbound (postmaster sender). Existing `send`/`fetchReplies` behaviour preserved.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** `simulateReply`/`simulateBounce` helpers building `InboundMessage`s (reply: from the recipient, with `inReplyTo`/`conversationId` of the sent ref; bounce: from `mailer-daemon@…`, subject `Undeliverable`, failed-recipient in body).

- [ ] **Step 4: Run → pass.** Commit — `feat(phase-5): mock email reply/bounce simulator`.

---

## Task 11: GraphDriver + MailpitDriver.fetchReplies

**Files:** Modify `lib/email/graph.ts`, `lib/email/mailpit.ts`; `tests/unit/email/graph.test.ts`

- [ ] **Step 1: Failing tests** (stub `fetch`): `GraphDriver.send` POSTs `/me/sendMail` with the `{message, saveToSentItems:true}` shape + bearer; `fetchReplies({since})` GETs `/me/mailFolders/Inbox/messages?$filter=receivedDateTime ge <since>` and maps to `InboundMessage[]` (`internetMessageId`→messageId, `conversationId`, `from`, `subject`, `bodyPreview`). Non-ok → `EmailDriverError`.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** `GraphDriver.send`/`fetchReplies` (inject `fetch`, default global; token from a passed accessor — for now read a `GRAPH_ACCESS_TOKEN`-style hook or accept it in the constructor; the delegated-token wiring is a deploy concern, spec §9). Implement `MailpitDriver.fetchReplies` against `GET {MAILPIT}/api/v1/messages` + per-message fetch, mapping to `InboundMessage`.

- [ ] **Step 4: Run → pass + `pnpm typecheck`.** Commit — `feat(phase-5): Graph send/fetchReplies + Mailpit fetchReplies`.

---

## Task 12: Server Actions

**Files:** Create `lib/actions/email.ts`

- [ ] **Step 1: Implement** (`'use server'`, mirroring `lib/actions/contacts.ts`): `runSenderNow(opts)` / `scanInboxNow(opts)` (build the Supabase-backed deps via the RLS-scoped server client + `getEmailDriver()`, call the cores, `revalidatePath`); `enrolInSequence(contactIds|campaignId)` (set `sequence_day` to first step + `follow_up` to today/next business day); `setCampaignSequence(campaignId, sequenceId)`; `addSuppression(email, reason)` / `removeSuppression(id)`. Compose existing `logTouchpoint`/`setContactStatus`/`updateContact` for the touchpoint/status effects (§8). Validation via zod.

- [ ] **Step 2: Verify** — `pnpm typecheck && pnpm lint`. (Action integration covered by the Task-14 e2e, per repo convention.)

- [ ] **Step 3: Commit** — `feat(phase-5): email server actions (run/scan/enrol/suppress/link)`.

---

## Task 13: Cron routes + UI

**Files:** Create `app/api/email/run/route.ts`, `app/api/email/scan/route.ts`; UI under `app/queue/`, additions to `app/sequences/`, a suppressions admin view; dev simulate buttons.

- [ ] **Step 1: Cron routes** (`runtime='nodejs'`): POST gated by `x-cron-secret` / `?secret=` vs `CRON_SECRET` (401 otherwise); call `runSender`/`scanInbox` core for each org (or the configured org). Mirror the Phase-4 webhook-route gating discipline.

- [ ] **Step 2: Queue/Run UI** (`app/queue/page.tsx` + client): due-today list with rendered subject per contact; "Run sender now" (calls `runSenderNow`), dry-run preview toggle, cap/remaining counter.

- [ ] **Step 3: Scan + activity UI:** "Scan inbox now" (calls `scanInboxNow`) with a result summary; recent `email_events` list. Sequence link + "Enrol contacts" control on `app/sequences`. Small suppressions admin (list + remove). Dev-only "Simulate reply/bounce" buttons gated by `isEmailMockEnabled()`.

- [ ] **Step 4: Verify** — `pnpm typecheck && pnpm lint && pnpm build`. Commit — `feat(phase-5): cron routes + queue/scan/enrol/suppression UI`.

---

## Task 14: e2e + final gate

**Files:** Create `tests/e2e/email-runner.spec.ts`

- [ ] **Step 1: Playwright spec** (collection-time loopback+service-key guard, like the Phase-4 e2e): seed (service role) a campaign linked to a 2-step sequence + a contact enrolled (follow_up today, email set); sign in `/auth/mock`; **Run sender now** → assert one `email_events(sent)` + a `Sent: <subject>` touchpoint + `sequence_day` advanced + next `follow_up` set; click **Simulate reply** then **Scan inbox now** → assert contact `green` + a `suppressions(replied)` row + the contact drops out of the next run's queue; **Simulate bounce** on another contact → `bounced` + `suppressions(bounced)`.

- [ ] **Step 2: Run** — `pnpm exec playwright test tests/e2e/email-runner.spec.ts` (boots `pnpm dev`). Expected: pass.

- [ ] **Step 3: Full gate** — `make db-reset && pnpm typecheck && pnpm lint && pnpm test && pnpm build`; manual `/auth/mock` walk-through of run → reply → bounce.

- [ ] **Step 4: Commit** — `test(phase-5): e2e email-runner walk-through (send/reply/bounce)`.

---

## Task 15: PR + Copilot loop

- [ ] **Step 1:** Open PR `feat/phase-5-email-runner` → `main`, body linking `docs/PHASE_5_SPEC.md`. (Bring `PHASE_5_SPEC.md` + this plan onto the branch.)
- [ ] **Step 2:** Run the Copilot review loop (dedupe repeated comments; verify before fixing; skip false positives with evidence) until "no new comments".
- [ ] **Step 3:** Squash-merge on approval.

---

## Self-review (author check vs spec)

- **Coverage:** §2 (T1), §3 (T3), §4 (T4), §5 (T8), §6/§7 (T5+T9), §8 (T7 store + T9/T8 via existing actions), §9 (T10+T11), §1/§10 (T12+T13), acceptance §12 (T14). All covered.
- **DECISIONS:** 1.1 cron route (T13), 2.1 campaign FK (T1), 3.1 verbatim unknown tokens (T3), 4.1 previous-send-relative cadence (T4/T8), 4.2 explicit enrol (T12), 5.1 ordering (T8), 7.1 classify heuristics (T5), 9.1 gated simulator (T10/T13). Covered.
- **Type consistency:** `EmailStore` methods (`dueContacts`/`recordSent`/`recordInbound`/`findSentForCorrelation`/`sentCountToday`/`lastScanHighWater`) used identically across T7/T8/T9; `EmailEventType`/`SuppressionReason` from T2 used throughout.
