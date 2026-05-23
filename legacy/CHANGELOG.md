# Changelog

Chronological log of major changes to Pauls Outreach Hub, most recent first.

---

## May 2026 - Dialler subsystem

### Dialler tab visual redesign (Aircall-style)

Replaced the original two-pane dialler layout with a three-column Aircall-inspired workspace.

- New header bar with title, connection status pill (pulsing green when on), and user pill placeholder for multi-user
- Day stats strip (Dialled / Connected / Voicemails / No Answer / Avg Duration)
- Three-column active call workspace: queue panel (left), call canvas (centre with big avatar + state pill + circular call controls), notes + outcome (right)
- Slim progress bar with inline stats during active runs
- Polished Aircall-style action buttons throughout the picker
- All functionality preserved - only the presentation layer changed
- Manual keypad sub-dialler retained current look (out of scope for this pass)

Files: `PaulsOutreachHub.html` (+CSS block ~250 lines, markup restructured)

### AMD via Cloudflare Worker (Mode B)

Added an optional automated voicemail detection mode using a Cloudflare Worker as a backend.

- Worker (`worker.js`, ~250 lines) orchestrates Telnyx Call Control API + AMD + webhook handling
- Server-Sent Events from Worker to browser for real-time call state
- "Start AMD Run" button alongside the existing "Start Run"
- Auto-hang on voicemail, no manual click required
- Voicemail touchpoints logged automatically; no-answer does NOT log a touchpoint (cleaner CRM)
- Original direct-WebRTC mode preserved as fallback
- Costs ~£3/month at 30 calls/day vs ~$300/month for a commercial parallel dialler

Files: `dialler-worker/worker.js`, `dialler-worker/README.md`, `PaulsOutreachHub.html` (new settings fields + AMD module)

### Manual keypad sub-dialler

Added a softphone-style keypad for one-off calls outside a run.

- Standard 12-button dial pad with DTMF tone feedback
- DTMF passthrough during active calls (for IVR navigation)
- Optional contact-linking via cross-campaign search
- Touchpoint logging only when linked to a contact
- Independent state from the run dialler (`MDIAL` vs `DIAL`)

Files: `PaulsOutreachHub.html` (~200 lines of keypad markup + JS)

### Telnyx WebRTC dialler (Mode A)

Initial dialler built. Direct WebRTC SDK integration.

- SDK lazy-loaded from CDN with 5-URL fallback chain (jsDelivr + unpkg, multiple versions)
- Phone number normaliser handling +CC / 00CC / leading-0 / bare formats - 8 test cases verified
- Hidden `<audio>` element for remote stream piping (triple redundancy: `client.remoteElement` + per-call option + manual `srcObject` attach)
- Opus codec discovered via `RTCRtpReceiver.getCapabilities` and preferred on every call for HD voice
- Audio constraints: echoCancellation + noiseSuppression + autoGainControl + 48kHz
- Synthesised UK ringback tones via Web Audio API (Telnyx WebRTC doesn't pipe network ringback reliably)
- State-driven tone playback: dialling beep, ringing 400+450Hz UK pattern, answered rising chime, hangup descending tone
- Run-based dialler with picker → active stages
- Outcome → touchpoint logging with status side-effects
- Skip list integration (notinterested status auto-skips in sequences)

Files: `PaulsOutreachHub.html` (~500 lines of dialler JS module + CSS)

### CSV importer fixes

- Last Name autoMapHeader bug fixed (`'last'` substring was matching "Last Touchpoint Channel", overwriting real Last Name mapping)
- Rewrote `csvAutoMap` with two-pass design (exact match locks the field, substring pass requires >=5 chars and skips already-taken fields)
- Verified mapping against all 27 Apollo CSV headers

### IndexedDB resilience

- Connection liveness probe before reusing cached connection
- `onversionchange` and `onclose` listeners drop the cached connection
- `idbWithRetry()` wrapper detects "closing" / "InvalidStateError" and retries once with a fresh connection
- localStorage fallback bypasses 60s throttle when IDB just failed
- LS cap raised from 2MB to 5MB
- `ok=true` returned when LS save succeeds (no more false "Save failed!" toasts)

---

## April-May 2026 - Email runner subsystem

### Sequence-aware autonomous runner

- PowerShell script reads `queue.csv`, composes per-sequence-step messages, sends via Outlook COM
- Daily cap (default 30/day), skip weekends
- Writes `send_log.csv` to disk, read back by the app via "Import disk send log"
- Send Activity dashboard view shows cross-campaign send history with unimported badge

### Reply scanner

- PowerShell reads Outlook inbox, matches replies to sent emails
- Updates contact status: `green` for positive replies, `notinterested` for negatives, leaves others alone
- Auto-adds touchpoint with reply summary

### Bounce scanner

- Detects bounce notification patterns from MAILER-DAEMON / postmaster
- Sets contact status to `bounced` (terminal, same as notinterested for sequence purposes)
- Adds to skip list

### Skip list infrastructure

- `skiplist.json` on disk, read by PowerShell runner before each send
- Populated by: reply scanner (notinterested), bounce scanner (bounced), manual user action
- One-way: once on, stays on

---

## Earlier 2026 - Foundation

### Multi-campaign CRM

- Campaigns → Contacts → Touchpoints data model
- 12 view tabs (Today / Pipeline / Send Activity / Templates / Dialler / Settings / Score / Funnel / Report / Admin / Activity / Sequences)
- IndexedDB primary store, localStorage fallback
- Daily snapshot retention (last 10)

### Imports

- Apollo.io CSV importer with field auto-mapping
- Per-contact research notes field
- Bulk status edit, bulk touchpoint addition
- One-per-company de-duplication for import batches

### Sequence templates

- Multi-step sequence definitions (5-step default: Day 1, 3, 7, 12, 15 working days)
- Per-step subject + body templates with variable substitution
- Working-day arithmetic that respects bank holidays + skip weekends

---

## Production deliverables (May 2026)

- `outreach-research-batch2-tightened-2026-05-06.xlsx` - 102 companies, 279 emails, verified vs templated tagged
- `import-tier2-outreach-1per-company.csv` - 71 contacts, 1-per-company
- `import-european-it-may2026.csv` - 54 contacts, European IT cluster (SAP dropped as competitor)

---

## Notes for future contributors

- Single HTML file deliberately - editable in Notepad, no build step
- Working file is at `Documents\MSPTool\PaulsOutreachHub.html`
- Worker source separate at `Documents\MSPTool\dialler-worker\`
- Run from `http://localhost` rather than `file://` so microphone permission persists
- See `MIGUEL_HANDOVER.md` for full architectural detail
