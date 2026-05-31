# Phase 5 — Executable Spec: Email runner (send + reply/bounce scanning via Graph)

**Status:** DRAFT for execution. **Phase:** 5 (per execution plan §3 — "Email runner via
Graph delegated: cron sender + reply scanner via Graph subscriptions; eliminación de
PowerShell + Outlook COM").
**Depends on:** Phase 1 (`contacts`/`touchpoints`/`campaigns`, `current_org_id()`),
Phase 2 (`sequences`/`sequence_steps`/`templates`, `logTouchpoint`, `setContactStatus`,
`updateContact`, `OrgSettings`), the **`EmailDriver`** seam (`lib/email/*`: `send` +
`fetchReplies` + optional `subscribeReplies`, with `mock` / `mailpit` working and `graph-*`
a `NotImplementedError` stub today).
**Source of truth mined:** `legacy/MIGUEL_HANDOVER.md` §6 (email-runner subsystem), §4.2/§4.3
(contact shape + **touchpoint discipline**), §5.3 (sequences), §5.4 (queue/compose), §5.5
(send activity + reply/bounce import), §11.1/§11.2 (suppression + compliance), §12.2 #9
(replace PowerShell+Outlook with Graph); the legacy PWA (`getSequences` L3799 — steps are
`{dayOffset, templateId}`, defaults day 0/3/7; merge tokens `{firstName}`/`{company}` L1183;
`seqSkipWeekends` weekend logic L5520–5524; `generateReplyScanner` L4220, `generateBounceScanner`
L4392, `importReplyLog` L4543, `importBounceLog` L4503, day-spread sender L5505+; daily cap
`dailyGoal` handover §6.4); `lib/actions/contacts.ts` (`logTouchpoint` L341,
`setContactStatus` L315, `updateContact` L247, `follow_up` is a `YYYY-MM-DD` DATE),
`lib/actions/sequences.ts` / `templates.ts`, `lib/types/domain.ts` (`OrgSettings.dailyGoal` /
`signature` / `seqSkipWeekends`), `lib/env.ts` (`EMAIL_DRIVER` enum + the mock gate pattern).

Implementation-oriented; no app code here. **[RESOLVED]** = decided with the product owner;
**[DECISION]** = defaulted by this spec, confirm at the spec-review gate.

---

## 0. Scope boundary (what Phase 5 is and is NOT)

**In scope — the email engine, fully runnable locally with no Graph consent:**

- A **send runner** that, for the contacts due today, renders the right sequence step's
  template, sends via the **`EmailDriver`**, logs the send, **advances the contact's sequence
  step**, and **schedules the next follow-up** (business-day aware) — replacing the legacy
  PowerShell+Outlook COM sender (handover §6, §12.2 #9).
- **Sequence-day progression + follow-up scheduling** driven by `sequence_steps`, linked to a
  campaign via a new `campaigns.sequence_id` FK **[RESOLVED]**.
- **Reply scanning** (a contact replied → stop their sequence, mark engaged) and **bounce /
  NDR scanning** (address is bad → suppress, mark bounced), both via the `EmailDriver`'s
  `fetchReplies` polling path, with a **mock** that simulates inbound replies/bounces so the
  whole loop is testable locally (handover §6.2).
- **The touchpoint auto-log discipline** of handover §4.3 (send/reply/bounce each write the
  right touchpoint + status side-effect), applied through the **store/RPC write path**
  (`EmailStore.recordInbound` / the `record_email_sent` RPC) — cron/service-role code can't
  invoke `'use server'` actions, and one atomic path avoids partial states. Status precedence
  reuses the Phase-3 `resolveStatusEffect` helper so the effect matches the actions' (see §8).
- A **dedicated `email_events` + `suppressions` data model** **[RESOLVED]** for per-message
  audit, reply/bounce correlation (dedup), and address-level suppression across campaigns
  (replaces the legacy `sentEmailIds` map + `skiplist.json`, handover §6.3).
- The **`GraphDriver`** implemented (`/me/sendMail`, `/me/mailFolders/.../messages` delta for
  replies) behind the existing seam, plus an extended **`MockDriver`** and **`MailpitDriver`**
  for local dev/test.
- **Runner triggers:** a manual **"Run sender now" / "Scan inbox now"** path for dev + ad-hoc
  use, and a **scheduled** trigger for production (handover §6.1 ran a 09:15 weekday cron).

**Explicitly out of scope (later phases / deploy-time — do NOT build here):**

- **Real Microsoft Graph consent / admin approval.** The Graph app-registration admin consent
  is explicitly **not blocking until Phase 5 deploy** (execution plan §3, the IT-ticket note)
  and is a deploy concern. Local acceptance runs entirely on `mock` (and optionally
  `mailpit`); the `graph-*` code is structurally complete and unit-tested on its pure pieces,
  but is not exercised against a live tenant in CI/local.
- **Graph change-notification subscriptions / webhooks** (`subscribeReplies`). **[RESOLVED:
  polling first]** Phase 5 ships the **polling** reply/bounce scanner (`fetchReplies`),
  matching the execution-plan "polling fallback en dev". A real-time subscription is a
  fast-follow that reuses the same correlation + effect logic; the `subscribeReplies` seam
  stays optional.
- **CTPS / GDPR right-to-be-forgotten / hash-chained audit** — Phase 6 (handover §11.2). The
  `suppressions` table created here is the substrate a GDPR opt-out path later writes to, but
  Phase 5 adds no compliance gating beyond reply/bounce/manual suppression.
- **Open / click tracking, A/B subject testing, AI-drafted copy** — not in legacy, not now.
- **Inbound reply content classification.** **[RESOLVED]** A reply sets status `green` and
  stops the sequence; Phase 5 does **not** parse reply text to infer `notinterested` (too
  fuzzy). The rep triages green contacts manually. (Legacy claimed content-based
  green/notinterested in §4.3, but that heuristic is not ported.)

**Why behind `EmailDriver`:** the seam already lets the UI and runner iterate for weeks
without Graph consent (execution-plan rationale table), makes testing trivial (canned
`MockDriver.inbound`), and lets `mock → mailpit → graph-dev → graph-prod` swap with no
refactor. Phase 5 is the first phase that makes `send` + `fetchReplies` do real work.

---

## 1. Architecture & data flow

```
  ┌─ browser (rep) ─ app/sequences, app/queue ─────────────────────────┐
  │  "Run sender now"  /  "Scan inbox now"   (dev + ad-hoc)             │
  └───────┬──────────────────────────────────────────────┬────────────┘
          ▼ Server Action                                  ▼ Server Action
  ┌──────────────────────────┐                  ┌──────────────────────────┐
  │  runSender(opts)         │                  │  scanInbox(opts)          │
  │  (lib/email/runner.ts)   │                  │  (lib/email/scanner.ts)   │
  └───────┬──────────────────┘                  └───────┬───────────────────┘
          │ select due contacts (§5)                    │ fetchReplies(since) (§6/§7)
          │ render template (§3)                        │ correlate vs email_events
          ▼ EmailDriver.send                            ▼ classify reply | bounce
  ┌──────────────────────────┐                  ┌──────────────────────────┐
  │ mock | mailpit | graph    │                  │ effects (§8):             │
  │  .send() → SentRef        │                  │  reply  → green + suppress │
  └───────┬──────────────────┘                  │  bounce → bounced+suppress │
          ▼ writes (one tx-ish flow)            └──────────────────────────┘
   email_events(sent) + touchpoint "Sent: …"
   + advance contacts.sequence_day + follow_up (§4)

  Scheduled trigger (prod): Vercel Cron → GET /api/email/run   →  runSender()
   (Authorization: Bearer $CRON_SECRET)   GET /api/email/scan  →  scanInbox()
   — secret in the header ONLY, never a query param (URLs leak into logs).
```

Both entry points (manual Server Action and scheduled route) call the **same pure-ish core**
(`runSender` / `scanInbox`) so behaviour is identical in dev and prod. The runner is a
**Node-runtime** path (the `mailpit` driver uses `nodemailer`; the `graph` driver uses
`fetch`), invoked manually from the UI or by a scheduler. **[DECISION 1.1]:** the scheduled
trigger is a **Next.js route** (`/api/email/run`, `/api/email/scan`) gated by a shared
`CRON_SECRET`, driven by Vercel Cron in prod; in dev the manual button is the only trigger
(no scheduler needed). Recommended — avoids splitting the driver logic into a Deno Edge
Function and keeps one code path. (Confirm vs a Supabase scheduled function.)

---

## 2. Data model (new migration `*_phase5_email_runner.sql`)

### 2.1 `campaigns.sequence_id` FK [RESOLVED]

```
alter table public.campaigns
  add column sequence_id uuid
    references public.sequences(id) on delete set null;
create index campaigns_sequence_id_idx on public.campaigns (sequence_id);
```

The free-text `campaigns.sequence` column is retained for legacy/display but is **no longer
load-bearing**; the runner reads steps from the linked `sequences` row's `sequence_steps`
(ordered by `step_order`, `day_offset` ascending). `on delete set null` so deleting a
sequence detaches campaigns rather than cascading away contacts. **[DECISION 2.1]:** keep
the FK at the **campaign** level (every contact in a campaign runs that campaign's sequence),
matching legacy `campaign.sequence`. (A per-contact `contacts.sequence_id` was offered and
declined — revisit only if mixed sequences within a campaign are needed.)

### 2.2 `contacts` additions

| Column | Type | Purpose |
|---|---|---|
| `last_emailed_at` | timestamptz null | Last successful send; powers the "already sent today" guard and cadence. Denormalised for cheap selection (also derivable from `email_events`). |

`contacts.sequence_day` (existing int) holds the **current step's `day_offset`** the contact
is on; `contacts.follow_up` (existing DATE) is reused as the **next-send date** (the same
column the dialler and Today view already use — one "next action date" per contact, exactly
as legacy used `followUp`). `contacts.status` + the `suppressions` table carry the
stop/engaged signals — **no** `replied_at`/`bounced_at` columns are added (those events live
in `email_events`; the durable contact-level signal is status + suppression).

### 2.3 `email_events` — append-only per-message log (audit + correlation)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid not null → organizations | RLS scope |
| `contact_id` | uuid not null → contacts(id) on delete cascade | |
| `campaign_id` | uuid → campaigns(id) on delete set null | for per-campaign reporting |
| `type` | text not null | `sent` / `reply` / `bounce` |
| `provider` | text not null | `mock` / `mailpit` / `graph-dev` / `graph-prod` |
| `message_id` | text | provider id (`SentRef.messageId` on send; inbound id on reply/bounce) — the dedup key |
| `conversation_id` | text | Graph `conversationId` / thread id for reply correlation |
| `in_reply_to` | text | inbound `inReplyTo` / `references` head, matched to a prior `sent` `message_id` |
| `subject` | text | |
| `sequence_day` | int | the step `day_offset` this send was for (null for inbound) |
| `occurred_at` | timestamptz not null default now() | |
| `payload` | jsonb not null default `'{}'` | trimmed provider metadata |
| `created_at` | timestamptz | |

Append-only (no UPDATE/DELETE policy — RLS-enforced immutability, like `touchpoints`).
Indexes: `(org_id, type, occurred_at)`, `(contact_id)`, unique `(org_id, provider,
message_id)` (the **send-dedup arbiter** — replaces legacy `sentEmailIds`, so a re-run
never double-records the same provider message). The unique index is **non-partial** so
it can serve as the `ON CONFLICT (org_id, provider, message_id)` arbiter for the
runner/scanner upserts; rows without a `message_id` still coexist because Postgres treats
NULLs as distinct.

### 2.4 `suppressions` — address-level do-not-send (replaces `skiplist.json`)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid not null → organizations | RLS scope |
| `email` | text not null | normalised `lower(trim(email))` |
| `reason` | text not null | `replied` / `bounced` / `manual` / `unsubscribed` |
| `contact_id` | uuid → contacts(id) on delete set null | best-effort link |
| `created_at` | timestamptz | |

Unique on the plain `(org_id, email)` column (not `lower(email)`) — one suppression per
address per org; the runner **left-anti-joins** against it. A plain-column index (rather
than an expression index) is required so it can be the `ON CONFLICT (org_id, email)`
arbiter for upserts; every writer lowercases the address first, so the column already
holds the normalised form. Suppression is **address-level** (handover §6.3: a bad/replied
address suppresses across every campaign), which `contacts.status` alone cannot express.

### 2.5 RLS & Realtime

All three follow the Phase-1/2 org-scoped pattern (`org_id = current_org_id()`): SELECT +
INSERT for the org; `email_events` has **no** UPDATE/DELETE (append-only); `suppressions`
allows DELETE (un-suppress / un-skip a contact who came back — closing the legacy "can't
un-skip" gap noted in handover §13). The runner/scanner run under the **caller's RLS-scoped
session** for manual triggers, and under a service-role-backed scoped query for the scheduled
route (resolving `org_id` per row). No Realtime requirement (these are batch flows; the UI
revalidates affected routes like the other Phase-2 actions).

---

## 3. Template rendering (merge fields)

Port legacy `composeForContact` (handover §5.4) token substitution. Templates
(`templates.subject` / `templates.body`) contain single-brace tokens; render replaces them
per contact:

| Token | Source | Missing → |
|---|---|---|
| `{firstName}` | `contact.first_name` | empty string |
| `{lastName}` | `contact.last_name` | empty string |
| `{company}` | `contact.company` | empty string |
| `{jobTitle}` | `contact.job_title` | empty string |
| `{signature}` | `OrgSettings.signature` | empty string |

**[DECISION 3.1]:** unknown tokens are left **verbatim** (not blanked) so a typo is visible in
the sent mail rather than silently dropped; missing *known* fields render empty. Confirm. Body
is sent as both `bodyText` and a minimally-formatted `bodyHtml` (the `OutboundMessage` shape
supports both, `lib/email/types.ts` L6–7). `from` is the org mailbox / the authenticated
user's address (Graph delegated sends as the user); `OrgSettings.signature` (handover §4.4)
is appended if the template body has no `{signature}` token. Rendering is a **pure function**
(`renderTemplate(template, contact, settings)`), unit-tested independent of sending.

---

## 4. Sequence-day progression & follow-up scheduling [RESOLVED model]

A campaign links to a `sequences` row (§2.1) whose `sequence_steps` are ordered by
`day_offset` (e.g. legacy day 0/3/7/12/15, `getSequences` L3799). For a contact:

- **Current step** = the step whose `day_offset == contacts.sequence_day` (a contact entering
  a sequence starts at the first step, `day_offset` of the min step, typically 0).
- **On a successful send of the current step:**
  1. write `email_events(type='sent', sequence_day=<current day_offset>)` + the send
     touchpoint (§8);
  2. set `contacts.last_emailed_at = now()`;
  3. find the **next** step (smallest `day_offset` greater than the current). If one exists:
     set `contacts.sequence_day = nextStep.day_offset` and
     `contacts.follow_up = businessDayAdd(startOrToday, nextStep.day_offset − currentStep.day_offset)`.
     If none (last step sent): set `contacts.follow_up = null` (sequence complete) — the
     contact stops surfacing in the runner.
- **`businessDayAdd(date, n)`** advances `n` calendar days, then — when
  `OrgSettings.seqSkipWeekends` is true (handover §4.4, default true) — rolls any
  Saturday/Sunday landing to the next Monday (legacy weekend guard L5520–5524). Pure,
  unit-tested with fixed input dates (no `Date.now()` in the pure core — the caller passes
  "today"; ADR/global rule on non-determinism respected).

**[DECISION 4.1]:** the cadence anchor for step *k* is **the previous send date**
(today, when the runner sends step *k−1*), advancing by the *delta* between consecutive step
`day_offset`s — so a delayed run doesn't compress the schedule. Alternative (anchor to a fixed
enrolment date) is offered; recommended is previous-send-relative, matching how a human cadence
actually drifts. Confirm.

**Entering a sequence:** **[DECISION 4.2]** a contact is "enrolled" when it has a non-null
`follow_up` and `sequence_day` and its campaign has a `sequence_id`. The initial enrolment
(set `sequence_day` to the first step, `follow_up` to today/next business day) is done by an
explicit **"Enrol in sequence"** action on the campaign/pipeline (legacy enrol UI), **not**
implicitly by the importer — confirm. Until enrolled, the runner ignores the contact.

---

## 5. The send runner (`runSender`)

`runSender(opts: { dryRun?: boolean; limit?: number; today?: string })` →
`{ planned, sent, skipped, errors }`. Core selection (legacy day-spread sender + handover
§6.1/§6.4):

**Eligible contact** (all must hold):

1. `contact.email` is non-null and valid;
2. `lower(email)` **not** in `suppressions` (covers replied/bounced/manual);
3. `contact.status` ∉ {`notinterested`, `bounced`} (redundant with suppression, but a cheap
   guard);
4. the contact's campaign has a `sequence_id` and the contact is **enrolled** (§4.2):
   `follow_up` is non-null and `follow_up <= today`;
5. a current/next due `sequence_step` exists for `contact.sequence_day`;
6. **not already sent today:** `last_emailed_at` is null or `< today` (idempotent re-run —
   reinforced by the unique `email_events(org,provider,message_id)` arbiter, §2.3).

**Ordering & cap:** order by `follow_up` ascending (most overdue first), then by sequence step
priority (handover §6.4 "newer contacts get earlier steps first" — **[DECISION 5.1]** order by
`sequence_day` ascending so early-step contacts are prioritised; confirm). Apply the **daily
cap** = `min(opts.limit ?? ∞, OrgSettings.dailyGoal ?? 30) − (emails already sent today)`,
where "already sent today" counts `email_events(type='sent')` with `occurred_at >= today`
(handover §6.4). When the cap is exhausted, stop and report how many were left (**no silent
truncation** — surface the remainder count).

**Weekend guard:** if `seqSkipWeekends` and today is Sat/Sun, the runner is a no-op (legacy
exited on weekends, L5520–5524).

**Per contact (the send unit):** render (§3) → `EmailDriver.send(message)` with a
`correlationId` = the contact/step → on success write `email_events(sent)` + send touchpoint
(§8) + advance step/follow-up (§4); on driver error, record it in `errors`, write **no**
touchpoint, leave the contact's step unchanged (so the next run retries), and continue
(one bad address never aborts the batch). **`dryRun`** does selection + render and returns the
`planned` list **without** sending or writing — the dev "preview the queue" path (legacy Queue
view, handover §5.4).

---

## 6. Reply scanning (`scanInbox` → replies)

`scanInbox(opts: { since?: string })` calls `EmailDriver.fetchReplies({ since })` (the polling
path; `mock` returns canned `inbound`, `graph` does a delta query on the mailbox). For each
inbound message:

1. **Correlate to a sent email:** match `inbound.inReplyTo` / `inbound.references` /
   `inbound.conversationId` against `email_events(type='sent').message_id` /
   `conversation_id`; fall back to matching the **sender address** to a `contact.email`
   (handover §6.2 matched replies to sent emails). No match → ignore (not our thread).
2. **Dedup:** if an `email_events(type='reply', message_id=inbound.messageId)` already exists,
   skip (idempotent re-scan).
3. **Effect (§8):** record `email_events(type='reply')`, set the contact `green`
   (`setContactStatus`, respecting the Phase-3 precedence — never downgrade a stronger
   terminal state), insert a `suppressions(reason='replied')` row to **stop the sequence**, and
   append an `email` touchpoint "Reply received". (Status `green` = engaged; the rep
   triages — no content classification, **[RESOLVED]**.)

`since` defaults to the persisted inbox-scan cursor: a high-water timestamp
(`organizations.settings.lastInboxScanAt`) PLUS the message-ids seen at exactly that
timestamp (`lastInboxScanIds`). Each scan advances the cursor to the newest message it
fetched — even when nothing correlated — so a quiet mailbox doesn't re-fetch the whole inbox
every cron tick. Drivers fetch `receivedAt >= since`, so a message at the boundary timestamp
is re-fetched; the id set is the tie-breaker — boundary ids already seen are skipped, while a
genuinely new message sharing that millisecond (a different id) is still processed. This lands
the cursor exactly on the newest timestamp without either re-processing the boundary forever
or skipping a same-ms late arrival. The cursor only advances after a scan completes without
error, so a mid-scan failure leaves it put and the next scan re-fetches and retries.

---

## 7. Bounce / NDR scanning (`scanInbox` → bounces)

Bounces arrive as **inbound NDR messages** (delivery-status notifications) the same scan
surfaces. Classify an inbound as a **bounce** when (handover §6.2 bounceScanner, legacy
`generateBounceScanner` L4392 / `importBounceLog` L4503):

- sender is a postmaster / mailer-daemon / `delivery` system address, **or** the message has a
  `report-type=delivery-status` content type / Graph delivery-failure marker, **and**
- the **failed recipient** (parsed from the NDR body / headers) matches a `contact.email` we
  sent to.

**Effect (§8):** record `email_events(type='bounce')`, set the contact `bounced`
(`setContactStatus`), insert `suppressions(reason='bounced')`, append a touchpoint
"Bounced — address undeliverable". A bounce is **terminal** for that address.

**[DECISION 7.1]:** reply-vs-bounce classification lives in a pure
`classifyInbound(message): 'reply' | 'bounce'` function, unit-tested against fixture messages
(a normal reply, an NDR). Whether an inbound is *relevant* (`ignore`) is the scanner's job —
it ignores anything that doesn't correlate to a contact we emailed — so `classifyInbound`
itself only decides the kind. The `mock` driver lets a test enqueue either kind via
`MockDriver.inbound`. Confirm the NDR-detection heuristics.

---

## 8. Touchpoint auto-log discipline & effects (authoritative) [RESOLVED]

Matches handover §4.3 exactly. The effects below are applied by the store layer
directly (`EmailStore.recordInbound` for inbound; the `record_email_sent` RPC for
sends), **not** by calling the Phase-2 Server Actions — cron/service-role code runs
outside a request and cannot invoke `'use server'` actions, and a single atomic write
path avoids partial states. Status precedence still reuses the Phase-3 `resolveStatusEffect`
helper (so the table's "precedence-guarded" semantics are identical to the actions'). The
`logTouchpoint`/`setContactStatus` column references below name the *equivalent* write each
effect performs, not a runtime call into those actions:

| Event | `email_events` | Touchpoint (`logTouchpoint`) | Status (`setContactStatus`) | Suppression | Sequence |
|---|---|---|---|---|---|
| **Send** | `sent` | `email`, note **`Sent: <subject>`** (handover §4.3) | unchanged | — | advance step + follow-up (§4) |
| **Reply** | `reply` | `email`, note `Reply received` | `green` (precedence-guarded) | add `replied` | **stop** |
| **Bounce** | `bounce` | `email`, note `Bounced — undeliverable` | `bounced` | add `bounced` | **stop** |
| **Manual unsubscribe / DNC** | — | `other`, note `Suppressed: <reason>` | (optional) | add `manual`/`unsubscribed` | **stop** |

- The **send touchpoint uses `channel='email'`** (the schema enum; legacy used the display
  string `'Email'`, handover §4.3) and note `Sent: <subject>` verbatim.
- **Status writes go through `setContactStatus`** and therefore inherit the Phase-3
  precedence rule (`resolveStatusEffect`, `lib/dialler/outcomes.ts`): `reply → green` never
  downgrades `meeting`; `bounce → bounced` is terminal and always applies.
- **Sequence stop = a suppression row** (not a status flag) — the runner's §5 selection
  left-anti-joins `suppressions`, so any of reply/bounce/manual cleanly halts further sends
  across all campaigns, and a `suppressions` DELETE re-enables (§2.5).
- Idempotency: every effect is keyed on `email_events` dedup (§2.3/§6.2/§7), so re-running the
  runner or re-scanning the inbox never double-logs.

---

## 9. `EmailDriver` implementations

The seam (`lib/email/driver.ts`) is unchanged. Phase 5 makes the drivers real:

- **`MockDriver`** (`lib/email/mock.ts`, extend the existing): `send` already records to
  `sent[]`. Add a **reply/bounce simulator** so the local loop is end-to-end testable — a
  helper to enqueue a simulated reply or NDR for a previously-"sent" message into `inbound`
  (so `fetchReplies` then returns it). **[DECISION 9.1]:** drive the simulator from a dev-only
  **"Simulate reply/bounce"** affordance in the UI (and a test API), mirroring how `/auth/mock`
  and the dialler mock fabricate events — gated by the same dev gate (§ below). Confirm.
- **`MailpitDriver`** (`lib/email/mailpit.ts`, extend): `send` already works via `nodemailer`.
  Implement `fetchReplies` against the **Mailpit REST API** (`GET /api/v1/messages` +
  search), so a developer can hand-reply in the Mailpit web UI and the scanner picks it up —
  an optional, higher-fidelity local path beyond the pure mock.
- **`GraphDriver`** (`lib/email/graph.ts`, replace the stub): `send` → `POST /me/sendMail`
  (`saveToSentItems: true`, the user's delegated token from the Supabase Azure session);
  `fetchReplies` → query on `/me/mailFolders/Inbox/messages` filtered by
  `receivedDateTime ge <since>`, **paging through `@odata.nextLink`** to drain every page,
  mapping to `InboundMessage` (`conversationId`, `internetMessageId`/`id`, `inReplyTo`).
  For an NDR (system-mailer sender) it recovers the **failed recipient** best-effort from
  the report text into `InboundMessage.failedRecipient` (an RFC 3464 `Final-Recipient` line,
  else the first non-system address in the subject/preview) so the scanner can correlate and
  suppress the prospect; an unrecoverable recipient means the bounce is ignored, never
  mis-correlated. Full `message/delivery-status` MIME parsing against a real tenant is a
  fast-follow. `subscribeReplies` stays optional (out of scope §0). The delegated **scopes**
  (`Mail.Send`, `Mail.Read`) are requested incrementally at login (execution plan §3 / §390)
  — a deploy concern; the driver assumes the token is present.

**Dev gate for the mock simulator** — `isEmailMockEnabled()` in `lib/env.ts`, triple-gated
exactly like `isAuthMockEnabled` (L100–106): `NODE_ENV !== 'production'` **and**
`EMAIL_DRIVER` is **`mock`** (only — *not* `mailpit`) **and** loopback Supabase URL. The
"simulate reply/bounce" affordance is inert otherwise. It is scoped to `mock` alone because
the simulator enqueues onto the process-global dev inbox that only `MockDriver.fetchReplies`
drains; `MailpitDriver.fetchReplies` reads the real Mailpit REST API, so under mailpit a
simulated message would never be scanned (use a real Mailpit round-trip there instead).

---

## 10. UI surfaces

- **Queue / Run (`app/queue` or extend `app/sequences`):** the **due-today list** (legacy
  Queue view, handover §5.4) showing each eligible contact + the rendered subject for their
  current step; **"Run sender now"** (calls `runSender`), with a **dry-run preview** toggle;
  the daily-cap/remaining counter.
- **Send Activity (extend `app/reports` or a new `app/activity` panel):** recent
  `email_events` (sent/reply/bounce) cross-campaign (legacy Send Activity, handover §5.5),
  plus **"Scan inbox now"** (calls `scanInbox`) with a result summary (N replies, N bounces).
- **Sequences (`app/sequences`):** add the **campaign↔sequence link** control (set
  `campaigns.sequence_id`) and an **"Enrol contacts"** action (§4.2).
- **Suppressions (small admin list):** view/remove suppressions (the un-skip path, §2.5).
- **Dev-only:** the "Simulate reply / Simulate bounce" buttons (gated, §9) on a sent contact,
  so a local demo can exercise the full reply→green→stop and bounce→suppress loop without a
  mailbox.

---

## 11. New / changed files (inventory)

| Path | Purpose |
|---|---|
| `supabase/migrations/*_phase5_email_runner.sql` | `campaigns.sequence_id` FK; `contacts.last_emailed_at`; `email_events` + `suppressions` tables + indexes + RLS (§2). |
| `lib/email/render.ts` | `renderTemplate(template, contact, settings)` merge-field substitution (§3) — pure. |
| `lib/email/schedule.ts` | `businessDayAdd` + next-step resolution (§4) — pure. |
| `lib/email/runner.ts` | `runSender(opts)` core (§5). |
| `lib/email/scanner.ts` | `scanInbox(opts)` + `classifyInbound` (§6/§7) — `classifyInbound` pure. |
| `lib/email/mock.ts` | Extend: reply/bounce simulator (§9). |
| `lib/email/mailpit.ts` | Implement `fetchReplies` via Mailpit REST (§9). |
| `lib/email/graph.ts` | Implement `send` + `fetchReplies` (§9). |
| `lib/actions/email.ts` | `runSenderNow`, `scanInboxNow`, `enrolInSequence`, `setCampaignSequence`, `addSuppression`, `removeSuppression` Server Actions composing `logTouchpoint`/`setContactStatus`/`updateContact` (§8). |
| `app/api/email/run/route.ts`, `app/api/email/scan/route.ts` | `CRON_SECRET`-gated scheduled triggers (§1). |
| `lib/env.ts` | `isEmailMockEnabled()`, `CRON_SECRET`, scope/secret schema entries. |
| `app/queue/`, `app/sequences/`, suppressions admin | UI (§10). |
| `tests/unit/email/render.test.ts` | Merge fields incl. missing/unknown tokens (§3). |
| `tests/unit/email/schedule.test.ts` | `businessDayAdd` incl. weekend roll + step deltas (§4). |
| `tests/unit/email/runner.test.ts` | Selection, daily cap, dedup, dry-run, error-isolation (§5) against `MockDriver`. |
| `tests/unit/email/scanner.test.ts` | scanner correlation + classify + effects + dedup; `classifyInbound` (reply/bounce) in `classify.test.ts` (§6/§7/§8). |
| `tests/e2e/email-runner.spec.ts` | Via `/auth/mock`: enrol → run sender (send + touchpoint + step advance) → simulate reply (green + stop) → simulate bounce (bounced + suppress). |

---

## 12. Acceptance criteria

1. `supabase db reset` applies the Phase-5 migration cleanly: `campaigns.sequence_id`,
   `contacts.last_emailed_at`, `email_events`, `suppressions` exist, org-scoped, with
   `email_events` append-only and the send-dedup unique index in place.
2. `renderTemplate` substitutes `{firstName}`/`{lastName}`/`{company}`/`{jobTitle}`/
   `{signature}` (missing known field → empty; unknown token → verbatim) — unit-tested.
3. `businessDayAdd` advances by calendar days and rolls weekends to Monday when
   `seqSkipWeekends`; step-to-step scheduling uses the consecutive `day_offset` delta —
   unit-tested with fixed dates.
4. With `EMAIL_DRIVER=mock` + `/auth/mock`, **"Run sender now"** sends to each eligible,
   enrolled, non-suppressed, due-today contact (respecting `dailyGoal`), and for each: writes
   one `email_events(sent)`, one `email` touchpoint `Sent: <subject>`, sets `last_emailed_at`,
   advances `sequence_day`, and sets the next `follow_up` (or null at sequence end).
5. **Dry-run** returns the planned list and writes nothing.
6. Re-running the sender the same day is a **no-op** for already-sent contacts (dedup) — no
   double touchpoint, no double step-advance.
7. **"Scan inbox now"** with a simulated reply sets the contact `green`, adds a
   `suppressions(replied)` row, logs a reply touchpoint, and **removes the contact from the
   next run's selection**; a simulated bounce sets `bounced`, adds `suppressions(bounced)`,
   logs a bounce touchpoint. Re-scan is idempotent.
8. Suppression is **address-level**: a suppressed email is skipped in **every** campaign;
   deleting the suppression re-enables sending.
9. The mock simulator + any seed route are inert unless `isEmailMockEnabled()` (dev + flag +
   loopback); the scheduled routes reject a missing/wrong `CRON_SECRET`.
10. Status writes never downgrade a stronger terminal state (reuse `resolveStatusEffect`).
11. `make typecheck`, `make lint`, `make test`, `make build` all green.

---

## 13. Open decisions (defaults chosen; confirm at review)

- **[DECISION 1.1]** Scheduled trigger = `CRON_SECRET`-gated Next route + Vercel Cron (one code
  path), not a Supabase scheduled function. *(Recommended.)*
- **[DECISION 2.1]** Sequence linked at the **campaign** level (`campaigns.sequence_id`), not
  per-contact. *(Resolved with owner; noted for completeness.)*
- **[DECISION 3.1]** Unknown merge tokens left **verbatim**; missing known fields → empty.
- **[DECISION 4.1]** Cadence anchored to the **previous send date** (delta-based), not a fixed
  enrolment date. *(Recommended.)*
- **[DECISION 4.2]** Sequence enrolment is an **explicit action**, not implicit on import.
- **[DECISION 5.1]** Run ordering: most-overdue `follow_up` first, then earliest
  `sequence_day`. Confirm priority.
- **[DECISION 7.1]** NDR/bounce-detection heuristics in `classifyInbound` (postmaster sender +
  delivery-status report type + failed-recipient match). Confirm the rule set.
- **[DECISION 9.1]** Reply/bounce simulation driven by a dev-only gated UI affordance + test
  API, mirroring `/auth/mock`. Confirm.
- **[DECISION 13.1 — future]** Graph change-notification **subscriptions** (real-time replies)
  deferred in favour of polling; revisit post-deploy.
