# Phase 3 — Executable Spec: Dialler "Mode A" (WebRTC direct, click-to-call + run dialler)

**Status:** DRAFT for execution. **Phase:** 3 (per execution plan §3 — "Dialler Mode A
(WebRTC directo) — Click-to-call desde cualquier vista de contacto, run dialler, outcome →
status").
**Depends on:** Phase 1 (schema, RLS, `contacts`/`touchpoints`), Phase 2 (CRUD surface,
`logTouchpoint`, `setContactStatus`, contact views).
**Source of truth mined:** `legacy/PaulsOutreachHub.html` (7 260 lines — `diallerNormalisePhone`
L6155, `diallerContactPhone` L6178, the call state machine L6092–6466, `diallerLogOutcome`
L6741, the run-dialler outcome buttons L987–993, the click-to-call modal `initiateCall`/
`logCallOutcome`/`confirmCallOutcome` L3233–3268, AMD SSE handling L7145–7219),
`legacy/MIGUEL_HANDOVER.md` §7 (Dialler subsystem), `lib/types/domain.ts`,
`lib/actions/contacts.ts` (`logTouchpoint`, `setContactStatus`), `lib/supabase/org.ts`,
`lib/email/*` (the driver-abstraction pattern this spec mirrors).

This document is implementation-oriented. It does **not** contain app code — it specifies what
Phase 3 must build. Open product decisions are flagged **[DECISION]**.

---

## 0. Scope boundary (what Phase 3 is and is NOT)

**In scope — Mode A only (browser WebRTC, direct dial):**

- Click-to-call from any contact surface (contact detail, Pipeline row, Today row).
- A **run dialler**: pick a queue of contacts, dial them one at a time, log an outcome per call,
  auto-advance to the next.
- A **manual keypad** sub-dialler for one-off numbers (optional contact linking).
- The **call lifecycle state machine** (idle → dialling → ringing → connected → ended →
  awaiting-outcome) surfaced in the UI.
- The fixed set of **call outcomes**, each mapping to a `contact_status` side-effect and **always**
  appending a `phone` touchpoint with a descriptive note.
- **Phone-number normalisation** to E.164 with an org default country code; mobile-preferred field
  selection.
- A **`DiallerDriver` abstraction** (mirroring `lib/email/`), with a **`mock`** implementation
  (simulated call lifecycle, for dev + tests) and a **`telnyx` stub** that throws
  `NotImplementedError` until Phase 4.

**Explicitly out of scope (later phases — do NOT build here):**

- **Mode B — AMD via Edge Function** (Telnyx Call Control + answering-machine detection,
  server-side webhook → Postgres → Realtime). This is **Phase 4**. In Phase 3 it lives only as the
  `telnyx` driver stub and the abstraction seam. The legacy AMD SSE path (`diallerHandleSSE`,
  `diallerLogVoicemailTouchpoint`, "Start AMD Run") is **not** ported here.
- Real Telnyx connectivity. Phase 3's only working driver is `mock`. The `telnyx` driver compiles
  (so the factory typechecks) but throws on use, exactly like `GraphDriver` in `lib/email/graph.ts`.
- Call recording, compliance gating (CTPS, GDPR right-to-be-forgotten, hash-chained audit) — Phase 6.
- Skip-list / suppression enforcement in the queue beyond the trivial "don't dial `notinterested`
  / `bounced`" default filter. Full skip-list logic is a later concern.

**Why the abstraction now:** the legacy app entangled WebRTC, AMD, and Telnyx SDK calls directly in
the view layer. Phase 3 puts a provider seam in place first (like `EmailDriver`) so that Mode B
(Phase 4) and any future provider drop in behind the same interface without touching outcome/queue
logic.

---

## 1. Call lifecycle states

The legacy state machine (comment at L6092, transitions in `diallerHandleNotification` L6436–6466):
`idle → connecting-sdk → sdk-ready → dialling → ringing → connected → hangup → awaiting-outcome`.
Phase 3 collapses the SDK-connection states into the driver's connection status (a separate
concern) and models the **per-call** lifecycle as the following finite states. These are the
`states` returned in the structured output.

| State | Meaning | UI shows | Legacy origin |
|---|---|---|---|
| `idle` | No active call. Picker / keypad visible; "Call" enabled. | Contact card placeholder ("Waiting for next dial…", L940), Call button. | `IDLE` (L6120) |
| `dialling` | Driver has placed the call; awaiting network progress. | Pulsing "Dialling…" badge, contact name + dialled E.164 number, Hang-up enabled. Optional dialling beep. | `requesting`/`trying` → `DIALLING` (L6441) |
| `ringing` | Remote end is ringing (ringback). | Pulsing "Ringing…" badge; ringback tone optional (off by default). | `ringing`/`early` → `RINGING` (L6442) |
| `connected` | Two-way audio established; call timer running. | "Connected" badge (green), live `mm:ss` timer (L6445–6446), mute/hold/hang-up controls, remote audio piped to a hidden `<audio>` element. | `active` → `CONNECTED` (L6443) |
| `ended` | Call terminated (hung up by either side, or failed). | Transient "Call ended" badge, then the **outcome panel** opens. | `hangup`/`destroy` → `diallerHandleHangup` (L6464) |
| `awaiting-outcome` | Call is over; user must log an outcome before advancing. | Outcome panel (note textarea + the §2 outcome buttons). Auto-advance is **gated** on this being resolved (`DIAL.pendingOutcome`, L6109). | `awaiting-outcome` (L6093, L6728) |

A terminal `failed` is folded into `ended` (legacy `FAILED`/`SDK ERROR`, L6120/L6694): the call did
not connect, the user still lands on the outcome panel and typically logs `no-answer`. Tone playback
(`diallerTone`, L6496) is **off by default** and is a presentation detail, not part of the state
contract.

**Transitions (happy path):** `idle → dialling → ringing → connected → ended → awaiting-outcome →`
(log outcome) `→ idle`. Early hangups skip straight from `dialling`/`ringing` to `ended`. The
`DiallerDriver` reports these via a callback/event stream; the `mock` driver simulates them on
timers (see §6).

---

## 2. Call outcomes

The legacy run dialler exposes six outcome buttons (`diallerLogOutcome`, buttons at L987–993:
Conversation/`connected`, Callback/`callback`, Voicemail/`voicemail`, No answer/`noanswer`,
Wrong no./`wrongnumber`, Not interested/`notinterested`). The click-to-call modal exposes a smaller
set (`logCallOutcome`: connected, voicemail, noanswer, wrong — L3258). Phase 3 **unifies** these into
one canonical outcome set used by both click-to-call and the run dialler, and adds two outcomes the
sales workflow clearly needs but the legacy buttons folded into a free-text note: **gatekeeper** and
**meeting-booked** (handover §7.5 maps a meeting via `connected → green`, but a booked meeting
deserves its own `meeting` status, which the schema already supports).

Canonical outcome keys (the `outcomes` in the structured output), labels are the user-facing button
text:

| Key | Label | Status effect | Default touchpoint note |
|---|---|---|---|
| `connected` | Connected — had conversation | `green` | `Call connected` |
| `callback-requested` | Callback requested | `green` (+ follow-up tomorrow) | `Callback requested` |
| `meeting-booked` | Meeting booked | `meeting` | `Meeting booked` |
| `left-voicemail` | Left voicemail | none (unchanged) | `Voicemail reached` |
| `no-answer` | No answer | none (unchanged) | `No answer` |
| `gatekeeper` | Gatekeeper / wrong person | none (unchanged) | `Reached gatekeeper` |
| `not-interested` | Not interested | `notinterested` | `Not interested` |
| `wrong-number` | Wrong number | `bounced` | `Wrong number` |

Notes on the mapping versus legacy:

- `connected` → `green`: legacy only promoted `none`→`green` (L3261, L6757). Phase 3 [DECISION 3]:
  set `green` unconditionally on a logged conversation **unless** the contact is already in a
  "stronger" terminal state (`meeting`); never downgrade `meeting`→`green`. Implementations should
  not clobber `meeting`/`notinterested`/`bounced` set by a later, more specific outcome — but a
  human conversation logged after those is a legitimate re-engagement, so [DECISION 3] confirms the
  precedence rule.
- `wrong-number` → `bounced`: legacy mapped wrong-number to `notinterested` and prepended
  `[Wrong number flagged via dialler]` to notes (L6759); handover §7.5 also lists it under skip-list
  logic. Phase 3 uses **`bounced`** because the schema has a dedicated `bounced` status that
  precisely means "this address/number is bad", which is semantically truer than "not interested"
  and keeps the two distinct in reporting. **[DECISION 4]** Confirm `wrong-number → bounced`
  (recommended) vs. legacy parity `wrong-number → notinterested`.
- `callback-requested` → `green` **and** sets `contacts.follow_up` to **tomorrow** (legacy set
  follow-up to now+24h, L6760). Phase 3 sets `follow_up` to tomorrow's date (`YYYY-MM-DD`).
- `meeting-booked` → `meeting`: new in Phase 3; uses the existing `meeting` enum member.
- `gatekeeper`: new neutral outcome; no status change, just a logged touchpoint so the SDR remembers
  to try again / route around. Folds the legacy free-text habit into a first-class button.
- `not-interested` is a **one-way** status (handover §7.5: "once set, sequence runner skips this
  contact"). Phase 3 sets `notinterested`; sequence-skip enforcement is a sequence-runner concern
  (Phase 5), not implemented here, but the status is the durable signal.

**Every logged outcome appends a `phone` touchpoint** (channel = `phone` — the schema enum member,
legacy used the display string `'Phone'`, L6755). The touchpoint note is the default note above,
and when the user typed free text in the panel it is appended as `"<default note>: <user note>"`
(matching legacy L6753–6754) — or `"<default note> — <user note>"` for the click-to-call path
(L3259); standardise on `": "`.

---

## 3. Outcome → effect mapping (authoritative)

For each logged outcome the dialler performs, in order:

1. **Append a touchpoint** via the existing `logTouchpoint(contactId, { channel: 'phone', note })`
   Server Action (`lib/actions/contacts.ts` L336). `note` is the composed note from §2. This happens
   for **every** outcome, with no exceptions.
2. **Apply the status side-effect** (if any) via the existing `setContactStatus(id, status)` Server
   Action (L310). Outcomes with status effect `none` skip this step — the contact's status is left
   untouched.
3. **Apply secondary effects**:
   - `callback-requested` → also set `contacts.follow_up = tomorrow` (via `updateContact(id,
     { followUp })`).
   - (No skip-list write in Phase 3; `wrong-number`/`not-interested` rely on their status alone.)

Because both touchpoint insert and status update flow through the **existing Phase 2 Server Actions**
under org-scoped RLS, Phase 3 introduces **no new write path** for the side-effects — it composes
the two existing actions. A thin `logCallOutcome(contactId, outcomeKey, note?)` Server Action
(new, `lib/actions/dialler.ts`) orchestrates the three steps in one round-trip and is the single
entry point used by both click-to-call and the run dialler. It must be idempotent-safe against a
double-click (the outcome panel disables its buttons after the first press, mirroring legacy
`DIAL.pendingOutcome=false`).

**The legacy AMD auto-no-answer rule** (handover §7.5 / §4.3, code L7197–7204): in Mode B, an
auto-detected **no-answer does NOT log a touchpoint** (to avoid CRM pollution), while an
auto-detected **machine/voicemail DOES log** "Voicemail reached - auto" (L7167, L7215). **This rule
does not apply to Mode A.** In Mode A every outcome — including `no-answer` — is logged **manually
by the user**, so it always produces a touchpoint by definition. The auto-skip-logging behaviour is
a Mode B (Phase 4) concern and is explicitly out of scope here. Phase 3 documents the distinction so
the Phase 4 author preserves it.

---

## 4. Phone-number normalisation and field selection

Port `diallerNormalisePhone(raw)` (L6155–6175) verbatim in behaviour into
`lib/dialler/normalise.ts` (`normalisePhone(raw, defaultCountryCode)` returning E.164 or `''`):

| Input | Output | Rule |
|---|---|---|
| `+44 7783 191491` | `+447783191491` | leading `+` → trust, strip non-digits |
| `+447783191491` | `+447783191491` | already E.164 |
| `00447783191491` | `+447783191491` | `00` exit-code → replace with `+` |
| `0044 7783 191491` | `+447783191491` | same, with separators stripped |
| `07783191491` | `+447783191491` | local: strip leading `0`, prepend default CC |
| `7783191491` | `+447783191491` | raw: prepend default CC |
| `` (empty) | `` | no number |

Algorithm (exactly as legacy): trim; record whether the first char is `+`; strip everything except
digits; if empty → `''`; if had `+` → `'+' + digits`; if `digits` starts with `00` (len ≥ 4) →
`'+' + digits.slice(2)`; else take the **default country code**, ensure it starts with `+`, strip a
single leading `0` from the local digits, and return `cc + digits`. Without this, `00`-prefixed
numbers route as "country code 00" and Telnyx returns `UNALLOCATED_NUMBER` (handover §7.4).

**Default country code source:** legacy read `SETTINGS.txDefaultCC` defaulting to `+44` (L6169).
Phase 3 reads `OrgSettings.defaultCountryCode` (already declared in `lib/types/domain.ts` L191,
sourced from `organizations.settings` jsonb), defaulting to `+44` when unset. **[DECISION 5]**
Confirm `+44` as the fallback default; it is DisplayNote's home market.

**Which field is dialled** (`diallerContactPhone`, L6178): **mobile preferred, else phone** —
`normalisePhone(contact.mobile || contact.phone || '', cc)`. Handover §4.2 marks `mobile` as
"preferred for dialler". A contact whose normalised number is `''` is **non-dialable**: the run
dialler skips it (with a visible "no number" marker in the queue) and click-to-call disables its
Call control. This mirrors legacy `initiateCall` aborting on no phone (L3235).

---

## 5. UI surfaces

### 5.1 Click-to-call (any contact view)

From contact detail, Pipeline rows, and Today rows, a Call control (legacy `initiateCall`, L3233):
dial `diallerContactPhone(contact)`, run the §1 lifecycle, and on `ended` open the outcome panel
(the §2 buttons + a note field). Logging routes through the single `logCallOutcome` Server Action
(§3). Unlike legacy — which used a `tel:` href + a manual outcome modal — Phase 3 drives the call
through the `DiallerDriver`, so the modal reflects live call state.

### 5.2 Run dialler (`/dialler`)

- **Picker:** filter the active campaign's contacts (by status, last-touch recency, country, free
  text — legacy L867–895), select a subset, optional shuffle (L895). Default filter excludes
  `notinterested` and `bounced`. "Start run (N selected)".
- **Active run:** a **call queue** (ordered list, L926–930), a **current-contact card** showing the
  §1 state + timer + controls, and the **outcome panel** (§2). Progress bar + per-run tallies
  (connected / voicemail / no-answer / logged — legacy `DIAL.stats`, L6106). Pause / Stop (L915–916).
- **Auto-advance:** after an outcome is logged, if "auto-advance" is on, wait `txCallDelay` (default
  ~3 s, L6773) then dial the next queued contact — but only once `awaiting-outcome` is resolved
  (`DIAL.pendingOutcome`, L6109/L6196). A "skip without logging" action advances without writing
  (legacy `diallerSkipNoLog`, L6785) — this is the **only** way to advance without a touchpoint in
  Mode A.

### 5.3 Manual keypad (optional, sub-dialler)

One-off dial pad (legacy L487–522): dial an arbitrary number normalised via §4, with **optional**
contact linking. Touchpoint logging happens **only if linked** to a contact (handover §7.3, legacy
note L492). Lower priority than 5.1/5.2 — ship if time allows.

---

## 6. The `DiallerDriver` abstraction (mirrors `lib/email/`)

New folder `lib/dialler/` modelled one-to-one on `lib/email/` (`types.ts`, `driver.ts`, `mock.ts`,
`telnyx.ts`, `index.ts` factory). The seam is intentionally provider-agnostic so Phase 4's Mode B
(AMD via Edge Function) and any future provider implement the same interface.

**`DiallerDriver` interface** (`lib/dialler/driver.ts`):

- `readonly name: string`
- `placeCall(opts: { to: string; from?: string; correlationId?: string }): Promise<DiallerCall>` —
  `to` is a normalised E.164 number; returns a handle.
- The returned `DiallerCall` exposes the live state (`CallState` = the §1 union), a way to subscribe
  to state transitions (callback or async event stream), and control methods `hangup()`,
  `mute(on)`, `hold(on)`, `sendDtmf(digit)` (the legacy controls, L6794–6809; DTMF L6844). Audio
  wiring (the hidden `<audio>` element, L6452) is the driver/client's concern, not the orchestrator's.
- Optional `connect()` / `disconnect()` for the SDK websocket connection status (legacy
  `diallerConnect`/`diallerDisconnect`, the "Telnyx connected/disconnected" pill).

Reuse the **error pattern** from `lib/email/types.ts`: a `DiallerDriverError extends Error`
(forwarding `cause` to the native `Error` option per ADR 003) and a `NotImplementedError` subclass.

**`MockDriver`** (`lib/dialler/mock.ts`): simulates the full lifecycle on timers —
`idle → dialling → ringing → connected → ended` with configurable delays, and supports forcing
specific terminal scenarios for tests (immediate no-answer, voicemail, normal hangup). Records placed
calls in an inspectable array (mirroring `MockDriver.sent` in `lib/email/mock.ts`) and exposes a
`reset()`. This is the **only** driver that actually "works" in Phase 3 and is what unit/e2e tests
run against.

**`TelnyxDriver`** (`lib/dialler/telnyx.ts`): a **stub** exactly like `GraphDriver`
(`lib/email/graph.ts`) — implements the interface but every method throws `NotImplementedError`.
The real WebRTC SDK integration (lazy CDN load, SIP-credential auth, Opus codec, audio constraints —
handover §7.1) lands when Mode A goes live against real Telnyx; the AMD/Call-Control path is Phase 4.

**Factory** (`lib/dialler/index.ts`): `getDiallerDriver()` switches on a `DIALLER_DRIVER` env var
(`'mock' | 'telnyx'`, default `'mock'`) — same shape as `getEmailDriver()` in `lib/email/index.ts`.
Add `DIALLER_DRIVER` to the Zod env schema (`lib/env.ts`).

---

## 7. New files (no app code in this spec — inventory only)

| Path | Purpose |
|---|---|
| `lib/dialler/types.ts` | `CallState` union (§1), `CallOutcome` keys + `OUTCOME_EFFECTS` map (§2/§3), `DiallerCall`, errors. |
| `lib/dialler/driver.ts` | `DiallerDriver` interface (§6). |
| `lib/dialler/mock.ts` | `MockDriver` — simulated lifecycle (§6). |
| `lib/dialler/telnyx.ts` | `TelnyxDriver` stub — throws `NotImplementedError` (§6). |
| `lib/dialler/index.ts` | `getDiallerDriver()` factory (§6). |
| `lib/dialler/normalise.ts` | `normalisePhone` + `pickDialNumber` (§4). |
| `lib/actions/dialler.ts` | `logCallOutcome(contactId, outcomeKey, note?)` Server Action composing `logTouchpoint` + `setContactStatus` (+ follow-up) (§3). |
| `app/dialler/` | Run-dialler route + components (§5.2); click-to-call control reused across contact views (§5.1). |
| `tests/unit/dialler-normalise.test.ts` | The 8 normalisation cases from §4 / handover §7.4. |
| `tests/unit/dialler-outcomes.test.ts` | Each outcome → status + touchpoint note assertions (§2/§3). |

---

## 8. Acceptance criteria

1. `normalisePhone` passes all rows in §4 (incl. the `00`-exit-code and leading-`0` cases) using the
   org default country code; `pickDialNumber` prefers `mobile` then `phone` and yields `''` for a
   contact with neither.
2. Every one of the eight §2 outcomes, when logged, inserts exactly one `phone` touchpoint with the
   specified default note (plus any user note appended as `": <note>"`), verified against the
   `MockDriver`.
3. Status side-effects match the §2 table exactly: `connected`/`callback-requested` → `green`,
   `meeting-booked` → `meeting`, `not-interested` → `notinterested`, `wrong-number` → `bounced`,
   and `left-voicemail`/`no-answer`/`gatekeeper` leave status unchanged. `callback-requested`
   additionally sets `follow_up` to tomorrow.
4. The call lifecycle drives through `idle → dialling → ringing → connected → ended →
   awaiting-outcome` against the `MockDriver`; advancing the run queue is blocked until the outcome
   is logged or explicitly skipped.
5. `getDiallerDriver()` returns `MockDriver` by default and `TelnyxDriver` (which throws
   `NotImplementedError`) under `DIALLER_DRIVER=telnyx` — the factory typechecks and the stub never
   silently no-ops.
6. No new write path: all DB mutations go through the existing `logTouchpoint` / `setContactStatus`
   / `updateContact` Server Actions under org-scoped RLS.
7. `make typecheck`, `make lint`, `make test`, `make build` all green.

---

## 9. Open decisions

- **[DECISION 3]** `connected` precedence: confirm "set `green` unless already `meeting`" (never
  downgrade `meeting`).
- **[DECISION 4]** `wrong-number` → `bounced` (recommended) vs. legacy parity `notinterested`.
- **[DECISION 5]** Default country-code fallback `+44`.
- **[DECISION 6]** Ship the manual keypad (§5.3) in Phase 3, or defer to a fast-follow.
- **[DECISION 7]** Outcome label wording (button text) for the two new outcomes (`gatekeeper`,
  `meeting-booked`) — confirm or adjust the user-facing copy.
