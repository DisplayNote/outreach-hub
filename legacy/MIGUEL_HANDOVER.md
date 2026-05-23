# Pauls Outreach Hub — Engineering Handover

**For:** Miguel (CTO, DisplayNote)
**From:** Paul McNicholl (Sales)
**Status of system:** Working in production, single-user, local deployment
**Date:** May 2026
**Read time:** ~25 minutes

---

## First 30 minutes — suggested reading order

If you only have time to skim, read these sections in order:

1. **§2 The business case** (1 min) — why this exists, what it saves
2. **§3 System architecture** (5 min) — the diagram tells most of the story
3. **§13 Decision log** (5 min) — gives you the "why we did X not Y" context for everything
4. **§15 Three things I'd do first** (2 min) — my opinion on where to start
5. **§11 Compliance posture** (5 min) — the only section where "shipping without action" is risky

Once you have that grounding, the rest is reference material.

**Companion files in this folder:**
- `PaulsOutreachHub.html` — the live app (single-file PWA)
- `CHANGELOG.md` — what was built when
- `dialler-worker/` — Cloudflare Worker source + deployment guide

---

## 1. What this is (in two paragraphs)

Pauls Outreach Hub is a single-file HTML web app that runs locally and manages outbound B2B prospecting (cold email + cold call). It owns a CRM-ish data model (campaigns → contacts → touchpoints), a sequence-aware email runner that drives Outlook via PowerShell, a Telnyx-backed WebRTC dialler with optional automated voicemail detection, and several auxiliary tools (reply scanner, bounce scanner, send activity dashboard, daily snapshots).

It was built incrementally over several weeks of pair-programming with an LLM (Claude) by a sales user (Paul, not an engineer). The motivating use case is a single SDR running 30-60 outbound touchpoints per day across email and phone, with one-touch outcome logging that respects skip lists, suppression rules, and basic compliance posture. The end-state we're driving toward is multi-user, hosted by Miguel's team, with proper backend orchestration for AMD and a foundation for AI-assisted outreach.

---

## 2. The business case (why it exists)

DisplayNote's outbound prospecting tooling options were:

- **Buy a commercial parallel-dialler** (e.g. Aircall, JustCall, Orum) — $200-300/month per seat plus per-minute costs
- **Use Zoho CRM's calling features** — works but coupled to Zoho, slow to customise, no AMD, no sequence-aware skip lists
- **Build a focused tool** — fully owned by us, integrates directly with our prospecting workflow, $5/month infrastructure ceiling

We went with build. Direct cost saving: ~$3,600/year per seat once Miguel's team takes over hosting. Indirect value: workflow tuning that off-the-shelf tools won't do (sequence + skip list + reply scanner logic specific to our outreach approach).

---

## 3. System architecture

### 3.1 Component diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                  USER (browser - Edge / Chromium)                │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  PaulsOutreachHub.html  (single-file PWA, ~407 KB)          │ │
│  │  • 12 views (Today, Pipeline, Dialler, Send Activity, etc.) │ │
│  │  • IndexedDB for state, localStorage for settings           │ │
│  │  • Telnyx WebRTC SDK (loaded lazily from CDN)               │ │
│  └──────────┬────────────────────────────────────┬─────────────┘ │
│             │                                    │               │
└─────────────┼────────────────────────────────────┼───────────────┘
              │                                    │
       (file:// or http://localhost)        (WebRTC + SSE)
              │                                    │
              ▼                                    ▼
   ┌──────────────────────┐         ┌──────────────────────────┐
   │  Local filesystem    │         │  Cloudflare Worker       │
   │  • PowerShell runner │         │  • AMD orchestration     │
   │  • skiplist.json     │         │  • Telnyx Call Control   │
   │  • CSV imports       │         │  • SSE → browser         │
   │  • Backup snapshots  │         │  (optional, AMD mode)    │
   └──────────┬───────────┘         └──────────┬───────────────┘
              │                                    │
              ▼                                    ▼
   ┌──────────────────────┐         ┌──────────────────────────┐
   │  Outlook (local)     │         │  Telnyx                  │
   │  • Sends via COM     │         │  • SIP / WebRTC / Call   │
   │  • Reads inbox       │         │    Control APIs          │
   │                      │         │  • Voicemail detection   │
   └──────────────────────┘         └──────────────────────────┘
```

### 3.2 Three layers, no servers (currently)

The app intentionally has no hosting layer. State lives in the browser (IndexedDB) and on the user's machine (PowerShell drops files to disk, reads CSVs back). The Cloudflare Worker is optional and only used when AMD mode is enabled — for the WebRTC direct-dial mode, no server is involved at all.

This is appropriate for the current single-user state but is the **first thing that needs to change** for team deployment. See Section 11 (Future Work).

### 3.3 Why single-file HTML

This was a constraint-driven decision: no build step, no node_modules, no Docker, no deploy pipeline, no CI. Paul can edit a file in Notepad and refresh his browser. This made iteration possible across weeks of solo work. The cost is that the HTML is now 7,255 lines and 407 KB.

**Recommendation for Miguel's hosted version:** split into proper modules (one file per view module, one per service: email-runner.ts, dialler.ts, storage.ts, telnyx.ts) and use Vite or similar. The data model and business logic transplant cleanly; the layout and styling can be reused as-is.

---

## 4. Data model

All persistent data lives in IndexedDB under the database name `outreach_hub_db`, store `state`. There's one big JSON blob: `APP`.

### 4.1 Top-level shape

```javascript
APP = {
  campaigns: [                  // array of campaign objects
    {
      id: "camp_1234567890",
      name: "UK MSP Q2 2026",
      sequence: "5-step",        // identifier of an active sequence template
      contacts: [/* see 4.2 */]
    }
  ],
  activeCampId: "camp_1234567890",  // which campaign is "current" in the UI
  sentEmailIds: { ... },         // dedup tracking for sent emails
  meta: {
    schemaVersion: 6,            // see outreach_hub_v6 storage key
    createdAt: "2025-...",
    lastSaved: "2026-05-..."
  }
}
```

### 4.2 Contact shape

```javascript
{
  id: 17234,                     // numeric, sequential per campaign
  firstName: "Mike",
  lastName: "Galkin",
  email: "mike.galkin@example.com",
  company: "FlutterUKI",
  phone: "+44...",               // landline
  mobile: "+44...",              // preferred for dialler
  jobTitle: "Director, IT",
  seniority: "Director",         // sometimes manually edited
  country: "United Kingdom",
  linkedin: "https://...",
  status: "amber",               // none|amber|red|green|meeting|notinterested|bounced
  sequenceDay: 7,                // current step in their sequence (1, 3, 7, 12, 15...)
  followUp: "2026-05-22T...",    // ISO date, used by Today view
  notes: "...",                  // free text; dialler reads suggested opener from here
                                 //   between === SUGGESTED EMAIL and === RESEARCH markers
  touchpoints: [                 // see 4.3
    { id: "tp...", channel: "Email", note: "Sent: subject", date: "2026-..." }
  ]
}
```

### 4.3 Touchpoint shape

```javascript
{
  id: "tp1747312345678",         // 'tp' + Date.now()
  channel: "Email" | "Phone" | "LinkedIn" | "Other",
  note: "Free-text description",
  date: "2026-05-15T09:23:11.000Z"
}
```

**Touchpoint discipline (important):**

- Email send → adds a touchpoint automatically with `channel: 'Email'` and `note: 'Sent: <subject>'`
- Reply scan → adds touchpoint, sets status to `green` or `notinterested` based on reply content
- Bounce scan → adds touchpoint, sets status to `bounced`
- Phone call (run dialler) → adds touchpoint when user logs an outcome (Connected/VM/etc.)
- Phone call (manual keypad) → adds touchpoint only if a contact is linked
- **AMD mode hangup on voicemail** → adds touchpoint automatically (Voicemail reached - auto)
- **AMD mode no-answer** → does NOT add a touchpoint (avoids CRM pollution)

### 4.4 Settings (separate storage)

```javascript
SETTINGS = {
  dailyGoal: 30,                 // soft cap on emails sent/day
  weeklyCallsGoal: 50,
  weeklyEmailsGoal: 150,
  rhythmGreen: 5,                // touchpoint thresholds for status colour
  rhythmAmber: 14,
  rhythmRed: 28,
  rhythmNone: 60,
  signature: "Paul (paul.mcnicholl@displaynote.com)",
  seqSkipWeekends: true,         // skip Sat/Sun in sequence math
  // Telnyx dialler
  txSipUser: "...",              // SIP credential username
  txSipPass: "...",              // SIP credential password (stored in plain text in localStorage)
  txCallerId: "+44...",          // outbound CLI
  txDefaultCC: "+44",            // default country code for normaliser
  txCallDelay: 3,                // seconds between calls
  txAutoMode: "auto",            // auto|manual advance
  // Cloudflare Worker (AMD mode)
  txWorkerUrl: "https://outreach-hub-dialler.xxx.workers.dev",
  txWorkerSecret: "...",         // shared secret matching Worker secret
  // Email runner integration
  outlookSendLogPath: "C:\\Users\\...\\Documents\\MSPTool\\autorun\\send_log.csv",
  // Snippets
  snippets: ["Quick value prop", "Mention CES demo", ...]
}
```

### 4.5 Storage keys

| Key | Purpose | Scope |
|---|---|---|
| `outreach_hub_v6` | Fallback when IndexedDB fails | localStorage (5MB cap) |
| `outreach_settings_v1` | All SETTINGS (always localStorage) | localStorage |
| `outreach_snapshots_v1` | Last 10 automatic JSON snapshots | localStorage |
| `outreach_handles_v1` | File System Access API handles (folder pickers) | IndexedDB-adjacent |
| `outreach_backup_handle_v1` | Backup folder handle | IndexedDB-adjacent |
| `outreach_backup_path` | String path for status display | localStorage |
| `outreach_zoho_url` | Zoho CRM "create lead" URL | localStorage |
| `outreach_hub_db` (the IDB database itself) | Main state | IndexedDB |

---

## 5. Module breakdown

The HTML is structured as twelve view containers (`<div class="view" id="view-X">`) controlled by a `switchView(viewName)` function. Each view has a corresponding render function.

### 5.1 Today (view-today)

Daily action list: contacts due for follow-up sorted by overdue-ness. Reads from all campaigns, filters by `followUp <= today`. Morning summary banner shows "you have X due today across Y campaigns".

Key functions: `renderToday()`, `daysSinceTouchpoint()`, `dueDate()`.

### 5.2 Activity (view-activity)

Per-contact recent touchpoint timeline. Useful for "what did we do with this lead last week".

Key functions: `renderActivity()`.

### 5.3 Sequences (view-sequences)

Definitions for multi-step outreach sequences (e.g. 5-step: Day 1 + Day 3 + Day 7 + Day 12 + Day 15 working days). Templates are stored per-sequence-step.

Key functions: `renderSequences()`, `nextSequenceStep()`, `nextSequenceDate()`.

### 5.4 Queue (view-queue)

Email send queue for a specific campaign — shows contacts ready to send to, with the templated body per their current sequence step. Used by the autonomous runner OR for click-to-send.

Key functions: `renderQueue()`, `composeForContact()`.

### 5.5 Send Activity (view-senddash)

Cross-campaign dashboard of what was sent recently. Pulls from in-app touchpoints AND from disk-stored `send_log.csv` (written by the PowerShell runner). Shows unimported logs as a red badge so the user knows to import.

Key functions: `renderSendDash()`, `importDiskSendLog()`.

### 5.6 Settings (view-settings)

All configurable knobs: daily goals, sequence rhythm thresholds, signature, Telnyx credentials, Cloudflare Worker URL/secret, Zoho URL, snippets list.

Key functions: `renderSettings()`, `loadSettings()`, `saveSettings()`.

### 5.7 Pipeline (view-pipeline)

Per-campaign contact list with bulk-edit, status filtering, touchpoint counts, follow-up dates. The main day-to-day surface.

Key functions: `renderPipeline()`, `bulkEditStatus()`, `addContact()`, `addTouchpoint()`.

### 5.8 Score / Funnel / Report (view-score, view-funnel, view-report)

Lightweight analytics — status breakdowns, conversion approximations, response rates. Not heavily used yet.

### 5.9 Admin (view-admin)

Snapshot management, IndexedDB diagnostics, danger-zone operations (clear all, restore from snapshot).

### 5.10 Dialler (view-dialler) **[main focus of recent work]**

See Section 7 for full detail.

---

## 6. Email runner subsystem

This is the autonomous outbound engine. It pre-dates the dialler and is the production-stable backbone.

### 6.1 How it works

1. User runs a PowerShell script (`C:\Users\<u>\Documents\MSPTool\autorun\sender.ps1`) on schedule (Windows Task Scheduler at 09:15 weekdays)
2. The script reads `queue.csv` (exported from the web app) and `skiplist.json`
3. For each row not on skiplist, it composes a message using the template for that contact's sequence step
4. It opens Outlook via COM, drafts the message, sends it
5. It writes a row to `send_log.csv` with timestamp, contact ID, subject, status
6. Respects daily cap (default 30/day) and skip weekends if configured

### 6.2 The user-facing integration

- Pipeline view → "Export queue.csv" button → user runs sender.ps1 manually OR via Task Scheduler
- Send Activity view → "Import send log" button → pulls the CSV back, creates touchpoints, marks contacts as sent
- Reply scanner → "Scan inbox" button → runs another PowerShell that reads Outlook inbox, matches replies to sent emails, updates contact status
- Bounce scanner → similar, looks for bounce notification patterns

### 6.3 Skip list

`skiplist.json` is a simple list of email addresses to never send to. Populated by:
- Reply scanner setting `notinterested` status
- Bounce scanner setting `bounced` status
- Manual user action via the Pipeline view
- (Future) Compliance pipeline (CTPS-flagged numbers, GDPR opt-out)

### 6.4 Daily cap logic

```javascript
// Pseudocode of what the runner enforces:
const todayLog = readSendLogForToday();
if (todayLog.length >= SETTINGS.dailyGoal) {
  console.log("Daily cap reached, exiting");
  exit();
}
// Sort by sequence step priority (newer contacts get earlier steps first)
// Honour seqSkipWeekends
```

### 6.5 Why PowerShell + Outlook

It pre-dates the dialler work. The original constraint was "use the Outlook signature, calendar, and reply-tracking that Paul already has". PowerShell + COM is the path of least resistance on Windows.

**For Miguel's hosted version:** this whole subsystem should probably be replaced with a proper SMTP-based service (SendGrid / Postmark / Microsoft Graph API) and a backend job runner. The data model around touchpoints and sequences is reusable; the delivery mechanism shouldn't be COM.

---

## 7. Dialler subsystem

The newest and largest single module. Two modes coexist.

### 7.1 Mode A — Direct WebRTC (default)

```
Browser ──┐
          │  TelnyxRTC SDK websocket
          ▼
       Telnyx ─── SIP/PSTN ───► Prospect's phone
```

- SDK loaded lazily from jsDelivr/unpkg CDN (5-URL fallback chain in `diallerLoadSDK()`)
- User authenticates with SIP credentials (NOT API key)
- `client.newCall()` places the call, audio comes back over WebRTC, attached to a hidden `<audio>` element
- Synthesised UK ringback tones available client-side (Web Audio API) — **OFF by default** since Telnyx network ringback works in most environments. User can toggle ON in Settings if their network strips the ringback. Setting key: `txSynthTones`.
- Opus codec preferred for HD voice (discovered via `RTCRtpReceiver.getCapabilities`)
- Audio constraints: `echoCancellation`, `noiseSuppression`, `autoGainControl`, 48kHz

Key functions: `diallerConnect()`, `diallerDial()`, `diallerHandleNotification()`, `diallerLoadSDK()`, `diallerTone()`.

### 7.2 Mode B — AMD via Cloudflare Worker

```
Browser ──POST /dial──► Worker ──Call Control API──► Telnyx
   ▲                       │                            │
   │                       │◄──── webhooks ─────────────┘
   │                       │ (call.machine.detection.ended, etc.)
   └──── SSE /events ──────┘
          │
   When AMD says human:  Worker tells Telnyx to transfer call
                         to the SIP user. Browser receives it
                         via the same WebRTC SDK as Mode A.

   When AMD says machine: Worker tells Telnyx to hangup. Logs
                          a "Voicemail reached" touchpoint.
                          Advances queue.
```

- Triggered by clicking "Start AMD Run" instead of "Start run"
- Requires Cloudflare Worker deployed and three secrets configured (see Section 9)
- Telnyx Premium AMD costs ~$0.005/call detection
- ~1-2% false-positive rate (hangs up on actual humans occasionally)
- Worker code in `dialler-worker/worker.js` (250 lines)

Key functions: `diallerWorkerDial()`, `diallerOpenSSE()`, `diallerHandleSSE()`, `diallerLogVoicemailTouchpoint()`.

### 7.3 Manual keypad sub-dialler

Independent of the run-based dialler. Single-contact one-off calls via a dial pad UI.

- DTMF tones audible to user on keypad press
- DTMF passthrough during active call (for IVR navigation: "press 1 for sales")
- Optional contact-linking via search across all campaigns
- Touchpoint logging only if linked

Key functions: `diallerToggleKeypad()`, `diallerKeypadPress()`, `diallerManualCall()`, `diallerManualLogOutcome()`.

### 7.4 Phone number normalisation

Centralised in `diallerNormalisePhone(raw)` and used by all three dial paths. Handles:

| Input format | Output |
|---|---|
| `+44 7783 191491` | `+447783191491` |
| `+447783191491` | `+447783191491` |
| `00447783191491` (European exit code) | `+447783191491` |
| `07783191491` (UK local) | `+447783191491` (strips leading 0, applies CC) |
| `7783191491` (raw) | `+447783191491` (applies CC) |

Without this normaliser the dialler would route 00-prefixed numbers as "country code 00" and get UNALLOCATED_NUMBER from Telnyx. Verified with 8 test cases.

### 7.5 Outcome → status side-effects

| Outcome | Status set | Other effects |
|---|---|---|
| `connected` | `green` | Touchpoint logged |
| `voicemail` | unchanged | Touchpoint logged "VM reached" |
| `noanswer` | unchanged | Touchpoint logged "No answer" |
| `callback` | `green` | Touchpoint + follow-up set to tomorrow |
| `wrongnumber` | `notinterested` | Touchpoint, contact added to skip list logic |
| `notinterested` | `notinterested` | Touchpoint, sequence paused |

`notinterested` is a one-way status — once set, sequence runner skips this contact. Same effect as bounce.

---

## 8. Telnyx setup (what to recreate)

For Miguel to bring this up in his environment, replicate this Telnyx configuration:

### 8.1 SIP Connection (for WebRTC direct-dial)

- Voice → SIP Connections → Add SIP Connection → **Type: Credentials**
- Authentication: generate a SIP username and password (these go into PaulsOutreachHub Settings)
- Outbound tab: assign an Outbound Voice Profile (see 8.3)
- Numbers tab: assign at least one Telnyx-owned phone number as CLI

### 8.2 Call Control Application (for AMD mode)

- Voice → Call Control Applications → Add new
- **Webhook URL:** `<your-cloudflare-worker-url>/telnyx`
- Webhook API version: v2
- Note the auto-generated **Connection ID** — needs to go into the Worker as a secret
- Outbound tab: assign the same Outbound Voice Profile

### 8.3 Outbound Voice Profile

- Voice → Outbound Voice Profiles → Add
- Traffic type: **Conversational** (not Short Duration, not Long Duration)
- **Destinations:** explicitly tick every country you intend to call. This is the most common cause of CALL_REJECTED for new accounts.
- Set daily/monthly spend caps as safety nets (recommend £20/day during early testing)

### 8.4 What goes where

| Value | Lives in | Used by |
|---|---|---|
| SIP Username | PaulsOutreachHub Settings | Mode A (WebRTC direct) |
| SIP Password | PaulsOutreachHub Settings | Mode A |
| Telnyx-owned phone number (CLI) | PaulsOutreachHub Settings (`Outbound CLI`) | Both modes |
| API key | Cloudflare Worker secret | Mode B (Call Control API) |
| Call Control Connection ID | Cloudflare Worker secret | Mode B |
| SIP Username (again) | Cloudflare Worker secret as `BRIDGE_SIP_USERNAME` | Mode B (transfer target) |

---

## 9. Cloudflare Worker

### 9.1 What it does

Three HTTP endpoints:

- `POST /dial` — receives a dial request from the browser, calls Telnyx Call Control API with AMD enabled, returns the call_control_id
- `POST /telnyx` — webhook receiver, Telnyx pushes call events here, Worker decides whether to bridge or hangup based on AMD result
- `GET /events` — Server-Sent Events stream, browser subscribes to get call state in real-time

Plus `/hangup` and `/health` for management.

### 9.2 State management

Two in-memory `Map` objects:

- `CALL_STATE` — call_control_id → call metadata (contactId, runId, AMD result, etc.)
- `SSE_CLIENTS` — runId → Set of active SSE writers

This is **single-instance** in-memory state. Works fine for a few thousand calls/day at one user but **WILL NOT scale to multi-user without changes** — different users on different Worker instances won't see each other's state.

**For multi-user hosted version**, this should move to Durable Objects (per-runId or per-call instance) so state survives Worker restarts and is consistent across regions.

### 9.3 Worker secrets

| Secret | Source | Purpose |
|---|---|---|
| `TELNYX_API_KEY` | Telnyx portal | Authorises Call Control API calls |
| `TELNYX_CONNECTION_ID` | Call Control App's auto-generated ID | Routes calls correctly |
| `SHARED_SECRET` | Generated random string | Gates `/dial`, `/hangup`, `/events` endpoints |
| `BRIDGE_SIP_USERNAME` | SIP Connection username | Transfer target for human-answered calls |
| `AMD_MODE` (optional) | `premium` (default) | Telnyx AMD profile |
| `NO_ANSWER_TIMEOUT_MS` (optional) | `22000` (default) | Auto-cancel ring timeout |

### 9.4 Costs

- Workers free tier: 100K requests/day. Current usage: <500/day per user.
- Durable Objects: not currently used (would be ~$5/month if added).
- Telnyx Premium AMD: ~$0.005/call detection. At 30 calls/day = ~£3/month.

### 9.5 Source

`dialler-worker/worker.js` (~250 lines, single file, no dependencies).
`dialler-worker/README.md` has step-by-step deployment instructions for the Cloudflare web dashboard.

---

## 10. Storage and recovery

### 10.1 IndexedDB behaviour

Browsers close IndexedDB connections under various conditions:
- User opens the app in a second tab
- Browser tab is idle for a while
- PWA backgrounded on mobile
- Memory pressure

We learned this the hard way. The current implementation:
- `idbOpen()` caches a connection BUT does a liveness probe before reuse
- `onversionchange` and `onclose` listeners drop the cached connection on close
- `idbWithRetry()` wraps every IDB operation, detects "InvalidStateError" / "closing", retries once with a fresh connection
- Falls back to localStorage if IDB fully fails (60-second throttle, bypassed when IDB just failed)
- localStorage cap raised to 5MB to hold a typical user's full state

### 10.2 Snapshots

`outreach_snapshots_v1` keeps the last 10 successful saves as JSON. User can restore from any of them via the Admin view. Snapshots auto-prune to prevent localStorage filling up.

### 10.3 Recovery procedures

If the app loads with blank state:

1. Open browser DevTools → Application tab → IndexedDB → outreach_hub_db → state. Is the data there?
2. If yes but app shows empty: hard reload, clear service worker cache
3. If no: check localStorage for `outreach_hub_v6` (fallback) — restore from that
4. If still no: Admin view → Restore from snapshot
5. If still no: Admin view → Import latest manual backup JSON file

If the user accidentally clears all:

1. Snapshots in localStorage likely survived (they're separate from IDB)
2. Daily backup JSON files (if user set up the backup folder) should exist on disk

### 10.4 Backup files

User can set a backup folder via the File System Access API (Edge/Chrome only). When set, the app writes a full JSON dump every save. This is the only off-machine-survivable backup currently — recommend Miguel adds proper cloud backup once hosted.

---

## 11. Compliance posture (what's good, what's not)

### 11.1 What we do right

- Skip list infrastructure: contacts can be added by user OR auto-added by reply/bounce scanner with `notinterested` / `bounced` status
- Touchpoint discipline: AMD-mode no-answer doesn't log a touchpoint (cleaner CRM)
- No prospect data leaves the browser unless Mode B is enabled
- Cloudflare Worker only stores transient call metadata, auto-cleared 30s after each call ends
- Email signature includes Paul's identity + DisplayNote affiliation

### 11.2 What's missing — must address before scale

**UK B2B cold calling: CTPS (Corporate Telephone Preference Service) screening.**

UK ICO requires that business numbers being cold-called are screened against CTPS every 28 days. We don't currently do this. Calling a CTPS-registered number without consent is a breach and can attract fines up to £500k.

**Fix:** integrate a CTPS check (commercial APIs available — REaD Group, DBS) that flags numbers, exports a delta CSV, user re-screens before each campaign. Marked numbers go on the skip list.

**EU/UK GDPR: lawful basis for storing prospect contact data.**

We rely on "legitimate interests" (B2B prospecting) but no formal Legitimate Interests Assessment (LIA) is recorded. We don't currently honour opt-out requests in any structured way (a "right to be forgotten" deletion).

**Fix:** add a `gdpr_status` field per contact (active/opted-out/deleted), wire a deletion path, document the LIA.

**Call recording (when added): consent.**

Telnyx supports call recording but UK PECR + GDPR require either (a) consent from both parties or (b) a clearly stated business purpose announced at call start. Currently NOT enabled.

### 11.3 What's deferred (later, not blocking)

- STIR/SHAKEN: US carriers increasingly require this for call attestation. Not relevant for UK→UK calls, becomes relevant when expanding to US prospecting at scale.
- CNAM registration: lets US callees see "DisplayNote" as caller ID. Optional, improves pickup rate.

---

## 12. Known gaps and future work

Itemised, in priority order:

### 12.1 Must-have for team deployment

1. **Multi-user authentication** — currently hardcoded as Paul. Settings, campaigns, contacts are all single-tenant. Needs an auth layer + user_id on every record.
2. **Hosted backend** — replace PowerShell+Outlook runner with a service. Replace local-only IndexedDB with a real database.
3. **CTPS integration** — see 11.2.
4. **Durable Objects in Worker** — see 9.2.

### 12.2 Should-have

5. **Call recording** — Telnyx supports it natively. Add `record: 'record-from-answer'` to Call Control dial command. Storage URL stays with Telnyx. Useful for sales coaching and compliance evidence.
6. **Power dialling (parallel lines)** — true predictive dialler. Telnyx supports concurrent calls; UX challenge is bridging the right answered call to the rep without confusion.
7. **Click-to-call from any contact view** — currently only from the Dialler tab.
8. **Proper test coverage** — there's no test scaffolding. Vitest + Playwright would be the lowest-friction add.
9. **Replace PowerShell + Outlook with Microsoft Graph API** — gives mobile/cross-platform email runner support.

### 12.3 Nice-to-have

10. **AI calling via Telnyx AI Assistants** — Paul has expressed interest. Honest caveats: ~5-15x cost per minute, brand risk on bad conversations, UK/EU legal requirements around AI disclosure to called party, additional GDPR profiling rules. **Recommend this is gated behind real evidence of operational need, not built speculatively.**
11. **CRM bidirectional sync with Zoho** — currently only one-way (button to open Zoho's "create lead" page).
12. **Reporting dashboard** — the Score / Funnel / Report views are scaffolds, not finished.

---

## 13. Decision log

Why we built X and not Y, with the trade-offs we made.

| Decision | Why | What we gave up |
|---|---|---|
| Single HTML file | Zero-build, Paul can edit + refresh | Lint, test, modularity |
| IndexedDB instead of cloud DB | No backend, no auth, no hosting cost | Multi-user, multi-device, off-machine survivability |
| PowerShell + Outlook for email | Uses Paul's existing signatures, calendar, threading | Windows-only, COM-fragile |
| Telnyx (not Twilio) | Cheaper UK rates, better AMD pricing, fewer compliance hoops | Smaller community, less third-party tooling |
| WebRTC SDK first, Worker later | Got it working in one session, no infra to maintain | Limited AMD support, can't do parallel dialling |
| Cloudflare Workers for AMD | Free tier covers our usage, edge-deployed, good SSE support | One more system to monitor, vendor lock-in to CF DX |
| Single-instance Worker state (Map) | Simple, fast for one user | Won't scale to multi-user — needs Durable Objects |
| Synthesised ringback tones (Web Audio) | Telnyx WebRTC doesn't pipe ringback reliably | Slight desync between heard ring and actual call state |
| Opus codec forced | HD voice vs G.711 narrowband | Telnyx leg negotiation could fall back anyway |
| AMD via Cloudflare, NOT Telnyx TeXML | Worker pattern reusable for AI calling later | TeXML would be marginally simpler today |
| `notinterested` and `bounced` as terminal statuses | Same skip-list semantics, no special-case code | Can't easily un-skip a contact who came back |
| Touchpoint logged only for human conversations + VMs (not no-answer) | Cleaner CRM, sales-relevant data only | Slight loss of "we tried" telemetry |
| No tests | Built solo, fast iteration, low risk if user notices regressions | Higher risk now that more users will use it |

---

## 14. Operations cheat-sheet

For when Miguel's team takes this over.

### 14.1 What's where

```
Documents/MSPTool/
├── PaulsOutreachHub.html          ← The app
├── autorun/
│   ├── sender.ps1                 ← Email runner
│   ├── replyScanner.ps1           ← Reply detection
│   ├── bounceScanner.ps1          ← Bounce detection
│   ├── queue.csv                  ← Generated by app, read by sender
│   ├── send_log.csv               ← Written by sender, imported by app
│   └── skiplist.json              ← Suppression list
└── dialler-worker/                ← Cloudflare Worker source
    ├── worker.js
    └── README.md
```

### 14.2 Daily ops

- Paul opens the app each morning (Edge PWA, pinned to taskbar)
- Today view shows what's due
- Send Activity view shows yesterday's batch + any unimported logs (red badge if so)
- Dialler tab is used for live calls; Mode A or AMD Run depending on appetite

### 14.3 Recovery if something dies

1. **Cloudflare Worker dies** → Mode A (direct WebRTC) still works. Mode B fails gracefully.
2. **Telnyx outage** → All dialling stops. Email runner still works.
3. **Outlook breaks** → Email runner stops. Reply scanner stops. Dialler still works.
4. **IndexedDB corrupts** → Restore from `outreach_snapshots_v1` localStorage. If that's also dead, restore from disk backup JSON.

### 14.4 If Paul leaks credentials in chat or screenshots (it's happened)

1. **Telnyx API key** — revoke immediately at https://portal.telnyx.com/#/app/api-keys, generate new, update Worker secret. Calls keep working with old WebRTC creds.
2. **SIP credentials** — Telnyx portal → SIP Connection → reset password. Update PaulsOutreachHub Settings. Affects WebRTC direct mode only.
3. **Cloudflare Worker secret** — Cloudflare dashboard → rotate. Update PaulsOutreachHub Settings to match.
4. **Outlook password** — Paul's IT problem, not ours, but worth flagging if AD account is shared.

### 14.5 Cost guardrails

- Telnyx wallet — set auto-recharge to OFF, manual top-ups only
- Outbound Voice Profile — daily spend cap (£20 currently)
- Cloudflare — Workers free tier, monitor for any unexpected paid features
- Total monthly burn at current usage: ~£10-15

---

## 15. Three things I'd do first if I were you

If Miguel asks me where to start:

1. **Get this hosted with proper auth.** The single-tenant local PWA is fine for Paul today but stops anyone else using it. Vite + React + Supabase (or similar) is a couple of days of work and unlocks team rollout.
2. **Replace the email runner before scaling.** PowerShell + Outlook will be a constant pain point. Microsoft Graph API does everything we use, cross-platform, no COM, no signature workarounds. ~1 week's work.
3. **Add CTPS screening before the third user.** UK B2B compliance breach is a real risk and ICO fines hurt. ~2-3 days to integrate a commercial API + workflow.

Everything else can wait until you have evidence it's needed.

---

## 16. Contact

Paul McNicholl — paul.mcnicholl@displaynote.com
Working file: `Documents\MSPTool\PaulsOutreachHub.html`
Worker source: `Documents\MSPTool\dialler-worker\`

Last updated: May 2026
