# Phase 2 — Executable Spec: CRUD + 12 views (functional parity with the legacy PWA)

**Status:** DRAFT for execution. **Phase:** 2 (per execution plan §3 — "CRUD completo + 12
vistas — paridad funcional con el HTML original, todo escrito en Postgres, importer CSV
Apollo").
**Depends on:** Phase 1 (schema migrated, RLS live, Today + Pipeline read-only landed).
**Source of truth mined:** `legacy/PaulsOutreachHub.html` (7 260 lines), `legacy/MIGUEL_HANDOVER.md`,
the Phase 1 migration `supabase/migrations/20260529120000_phase1_domain.sql`,
`lib/types/domain.ts`, `lib/supabase/queries.ts`, `lib/supabase/server.ts`.

This document is implementation-oriented. It does **not** contain app code — it specifies what
Phase 2 must build. Open product decisions are flagged **[DECISION]**.

---

## 0. Scope boundary (what Phase 2 is and is NOT)

**In scope:** turn every read-only/absent screen into a full CRUD surface backed by Postgres
via Server Actions, plus the Apollo CSV importer. All data writes go through Supabase under
org-scoped RLS — no IndexedDB, no localStorage, no PowerShell, no file system.

**Explicitly out of scope (later phases, do NOT build here):**

- Dialler (WebRTC / AMD) — Phases 3 & 4. The `view-dialler` screen and Telnyx are deferred.
- Email send runner / reply & bounce scanners (PowerShell + Outlook, or its Graph replacement)
  — Phase 5. Phase 2 models *sequences and templates* and *logs* email touchpoints, but does
  **not** actually send mail.
- Compliance (`gdpr_status`, right-to-be-forgotten, CTPS, call recording, audit log) — Phase 6.
- Zoho sync, power dialling, AI calling, finished reporting dashboards — Phase 8.

Because the dialler and the runner are out of scope, several legacy fields/behaviours are
**parked**: `callStatus`, Telnyx settings, the AMD touchpoint rules, `send_log.csv` disk import.
Where the legacy UI mixes these in (e.g. Pipeline's call-status filter), Phase 2 ships the
email/manual subset and leaves a clearly-labelled gap.

---

## 1. The 12 legacy views — inventory and Phase 2 disposition

The legacy app exposes exactly 12 `<div class="view">` containers, switched by `switchView()`.
Verbatim ids and line refs from `legacy/PaulsOutreachHub.html`:

| # | Legacy id (line) | Legacy purpose | Phase 2 disposition | Route |
|---|---|---|---|---|
| 1 | `view-today` (384) | Daily action list: contacts due for follow-up, sorted by overdue-ness. | **Exists** (read-only, Phase 1). Add: quick-log touchpoint, edit follow-up, status change inline. | `/today` |
| 2 | `view-activity` (394) | Per-contact recent touchpoint timeline. | **New.** Cross-campaign touchpoint feed with range filter (today / week / all). | `/activity` |
| 3 | `view-sequences` (406) | Multi-step sequence definitions (Day 1/3/7/12/15 working-days) + per-step templates. | **New.** CRUD on sequences + steps + templates. See §3.3 / open decision on storage. | `/sequences` |
| 4 | `view-queue` (416) | Per-campaign email send queue with templated body per current step. | **New (modelling only).** Show *who is due for which step* and the rendered template, as a read view. Actual sending is Phase 5 — no "Send" button wired. | `/queue` |
| 5 | `view-senddash` (430) | Cross-campaign "what was sent recently" dashboard; imports `send_log.csv` from disk. | **Partial / deferred.** Disk import is Phase 5. Phase 2 ships a recent-email-touchpoint feed only (derived from `touchpoints WHERE channel='email'`). | `/send-activity` |
| 6 | `view-dialler` (447) | WebRTC + AMD dialler, keypad, outcome logging. | **Deferred to Phase 3/4.** Not built in Phase 2. | — |
| 7 | `view-settings` (1020) | Goals, rhythm thresholds, signature, snippets, Telnyx creds, Zoho URL. | **New (subset).** Org-level settings: daily/weekly goals, rhythm thresholds, `seqSkipWeekends`, signature, snippets. Telnyx + Zoho parked. See §6. | `/settings` |
| 8 | `view-pipeline` (1096) | Per-campaign contact table: filters, bulk status edit, touchpoint counts, follow-up. **Main surface.** | **Exists** (read-only, Phase 1). Add full CRUD: add/edit/delete contact, inline status, bulk status, filters, sort, search. | `/pipeline` (+ `/campaigns/[id]`) |
| 9 | `view-score` (1155) | Status breakdown / scoring. | **New (lightweight).** Status rollup (already have `getPipelineSummary`). | `/reports` (tab) |
| 10 | `view-funnel` (1165) | Conversion-funnel approximation. | **New (lightweight).** Funnel from status counts. | `/reports` (tab) |
| 11 | `view-report` (1171) | Response-rate / activity report. | **New (lightweight).** Touchpoint + status report. | `/reports` (tab) |
| 12 | `view-admin` (1177) | Snapshot mgmt, IndexedDB diagnostics, danger-zone. | **Replaced, not ported.** IndexedDB/snapshots are obsolete under Postgres. Phase 2 ships a minimal Admin: CSV import entry point + danger-zone "delete campaign". Backups are a DB/infra concern. | `/admin` |

**[DECISION 1]** Score/Funnel/Report were "scaffolds, not finished" in the legacy app
(handover §12.3). Proposal: collapse the three into a single `/reports` route with tabs, ship
the status rollup + simple funnel, and defer rich reporting to Phase 8. Confirm this collapse is
acceptable for "12-view parity," or keep three distinct routes.

**[DECISION 2]** Legacy view names are sales-user vernacular (Queue, Send Activity). Confirm the
proposed route slugs (`/send-activity`, `/queue`, `/reports`) or rename.

---

## 2. CRUD surface per entity

All writes are **Server Actions** (`'use server'`) invoked from client components or `<form action>`.
They use the server Supabase client (`@/lib/supabase/server` → `createClient()`), which is
RLS-scoped to the caller's org via `public.current_org_id()`. **Therefore:**

- On **INSERT**, the action MUST set `org_id` to the caller's org. The org id is not yet exposed
  by a helper — **[DECISION 3]** add `getCurrentOrgId()` to `lib/supabase/queries.ts` (selects
  `public.current_org_id()` via `supabase.rpc` or a `select`), or read it from the session
  claims. Pick one and document it; every INSERT depends on it.
- On **UPDATE / DELETE**, target by `id` only. RLS already constrains rows to the caller's org;
  do not also filter by `org_id` in the query (queries.ts comment confirms this convention).
- Every action revalidates the affected route(s) via `revalidatePath`.
- Inputs validated with Zod at the action boundary; return a typed `{ ok } | { error }` result.

### 2.1 Campaigns (`public.campaigns`)

Editable fields: `name` (required), `sequence` (nullable text — sequence identifier).
`legacy_id` is importer-only; never set from the UI.

| Operation | Action (proposed) | Notes |
|---|---|---|
| List | `listCampaigns()` *(exists in queries.ts)* | ordered by name. |
| Create | `createCampaign(input)` | set `org_id`, `name`; `sequence` optional. |
| Rename / set sequence | `updateCampaign(id, patch)` | partial update of `name` / `sequence`. |
| Delete | `deleteCampaign(id)` | cascades to contacts → touchpoints (`on delete cascade`). Danger-zone confirm in UI. |
| Read one (with contacts) | `getCampaign(id)` *(new query)* | drives `/campaigns/[id]` / pipeline. |

### 2.2 Contacts (`public.contacts`)

Editable field set (legacy `openEdit`/`saveC`, lines 2172-2209) mapped to Phase 1 columns:

| Legacy field | Phase 1 column | Notes |
|---|---|---|
| firstName | `first_name` | |
| lastName | `last_name` | |
| company | `company` | **required in legacy** (`saveC` rejects empty). Keep required. |
| email | `email` | |
| mobile | `mobile` | preferred dial number (dialler era). |
| phone | `phone` | landline. |
| linkedin | `linkedin` | |
| seniority | `seniority` | |
| jobTitle | `job_title` | legacy edit form folds title into seniority; keep both columns, expose both. |
| country | `country` | |
| followUp | `follow_up` | `date` (YYYY-MM-DD); nullable. |
| notes | `notes` | free text. |
| status | `status` | enum; default `none`. |
| sequenceDay | `sequence_day` | current step day (int); set by sequence progression (§3.3). |

Legacy-only fields with **no Phase 1 column** — **[DECISION 4]**: `website`, `city`, `state`,
`industry`, `employees`, `keywords`, `technologies`, `annualRevenue`, `apolloAccountId`,
`apolloContactId`, `source`, `emailStatus`, `callStatus`, `zohoId`. Options: (a) drop for Phase 2,
(b) stuff into `notes`, (c) add a `metadata jsonb` column to `contacts` in a Phase 2 migration to
preserve Apollo enrichment losslessly. **Recommendation: (c) add `contacts.metadata jsonb` so the
Apollo importer doesn't silently discard data** (`apollo*` ids matter for the future Apollo MCP
link-out). This is the one schema change Phase 2 should make.

| Operation | Action (proposed) | Notes |
|---|---|---|
| List (per campaign) | `listContacts(campaignId, filters)` *(new)* | filters/sort/search — see §2.4. |
| Create | `createContact(campaignId, input)` | set `org_id`, `campaign_id`; company required. |
| Edit | `updateContact(id, patch)` | partial; any editable field above. |
| Delete | `deleteContact(id)` | cascades touchpoints. |
| Set status | `setContactStatus(id, status)` | inline + bulk; see §3.1 transitions. |
| Bulk status | `bulkSetStatus(ids[], status)` | legacy `bulkEditStatus`. One action, many ids. |
| Set follow-up | `setFollowUp(id, date \| null)` | from Today / detail. |
| Read one | `getContact(id)` *(new)* | with touchpoints for detail view. |

### 2.3 Touchpoints (`public.touchpoints`) — append-only

Touchpoints are an immutable log (no `updated_at`). `channel` enum is lower-case
(`email|phone|linkedin|other`); legacy stored title-case — map on the way in. Legacy "WhatsApp"
and "Video" channels collapse to `other`.

| Operation | Action (proposed) | Notes |
|---|---|---|
| Log | `logTouchpoint(contactId, {channel, note, occurredAt?})` | set `org_id`, `contact_id`; `occurred_at` defaults to now(). |
| List (per contact) | `getContact(id)` includes them, or `listTouchpoints(contactId)`. | newest first. |
| Delete | `deleteTouchpoint(id)` | legacy `delTP` allows removing a mistaken entry. Keep — it is the only mutation on the log. |
| Feed (cross-contact) | `getActivityFeed(range)` *(new)* | drives `/activity` + `/send-activity`. |

No edit operation: to "correct" a touchpoint, delete and re-log (matches legacy).

### 2.4 Filter / sort / search surface (Pipeline)

From legacy `filteredContacts` (lines ~2100-2127). Phase 2 supports, server-side where the row
count warrants, otherwise client-side over the campaign's contacts:

- **Search** across name / company / email (free text).
- **Status filter** — any of the 7 `contact_status` values, or "all".
- **Country filter** — distinct countries present, plus a "(no country)" bucket.
- **Follow-up-only** — `follow_up <= today` (overdue + due).
- **Source filter** (apollo / missing) — **parked** unless `metadata` lands (DECISION 4c).
- **Call-status filter** — **parked** (dialler, Phase 3).
- **Sort** by any column, asc/desc (legacy `srt(f)`).

---

## 3. Business rules to preserve (verbatim from legacy)

### 3.1 Contact status semantics + transitions

Enum `contact_status`: `none | amber | red | green | meeting | notinterested | bounced`
(declaration order preserved in `lib/types/domain.ts#CONTACT_STATUSES`).

Meaning mined from legacy:

| Status | Meaning | Set by |
|---|---|---|
| `none` | Never contacted / fresh. | default. |
| `green` | Engaged / positive reply / connected on call. | reply scanner (positive), dialler `connected`/`callback`. |
| `amber` | Warm but going quiet. | rhythm staleness, manual. |
| `red` | Cold / overdue / at-risk. | rhythm staleness, manual. |
| `meeting` | Meeting booked. | manual. Excluded from staleness + reminders. |
| `notinterested` | Declined. **Terminal** — sequence runner skips forever. | reply scanner (negative), dialler `wrongnumber`/`notinterested`, manual. |
| `bounced` | Email hard-bounced. **Terminal** — same skip semantics as `notinterested`. | bounce scanner, manual. |

Rules to enforce in Phase 2:

1. `meeting` and `notinterested` are **excluded from staleness/reminder calculations**
   (`isStale`, `reminderBadge` early-return on them — lines 2004, 3000).
2. `notinterested` and `bounced` are **terminal**: they remove the contact from any send queue
   and sequence progression (legacy decision log: "one-way status"). Phase 2 enforces this in the
   `/queue` query (exclude these statuses) even though sending is deferred.
3. All transitions are otherwise **free** (any → any) via manual status edit. Phase 2 does NOT
   impose a state machine beyond the two terminal-skip rules; the dialler/scanner-driven
   transitions (the side-effects in §3.2) arrive in Phases 3-5.

**[DECISION 5]** The legacy `amber/red` are partly auto-derived from the rhythm thresholds
(`isStale` / `getRhythmDays`) and partly manual. Confirm Phase 2 keeps status as a *manually-set*
field (with rhythm only driving a visual "stale" badge, not the stored status) — this matches
legacy, where `isStale` colours a badge but does not overwrite `c.status`.

### 3.2 Touchpoint-logging discipline (what auto-adds a touchpoint)

From handover §4.3 and legacy outcome tables. **Of these, only the email/manual rules are in
Phase 2 scope; dialler/scanner rules are documented for forward-compat and built in later phases:**

| Trigger | Auto-touchpoint | Phase |
|---|---|---|
| Email send | `channel=email`, `note='Sent: <subject>'` | log path Phase 2 (manual "log email"); auto on send Phase 5. |
| Reply scan (positive) | touchpoint + status→`green` | Phase 5. |
| Reply scan (negative) | touchpoint + status→`notinterested` | Phase 5. |
| Bounce scan | touchpoint + status→`bounced` | Phase 5. |
| Dialler outcome `connected` | touchpoint + status→`green` | Phase 3. |
| Dialler `voicemail` / `noanswer` | touchpoint, status unchanged | Phase 3. |
| Dialler `callback` | touchpoint + status→`green` + follow-up = next business day | Phase 3. |
| Dialler `wrongnumber`/`notinterested` | touchpoint + status→`notinterested` | Phase 3. |
| AMD machine-detected hangup | touchpoint `'Voicemail reached - auto'` | Phase 4. |
| AMD no-answer | **NO touchpoint** (avoid CRM pollution) | Phase 4. |

**Phase 2 deliverable:** a manual "Log touchpoint" UI (channel + note) on Today, Pipeline, and
contact detail; plus a convenience "Log email sent" that writes `channel=email, note='Sent: …'`.

### 3.3 Sequence-day progression + follow-up date math (business-day aware)

Legacy sequences are step lists with **working-day offsets**. The canonical 5-step sequence is
**Day 1 / 3 / 7 / 12 / 15 working days** (handover §5.3; legacy comment line 5041-5044: step
`dayOffset` 0 = Day 1/today, 2 = Day 3, 6 = Day 7, 11 = Day 12, 14 = Day 15).

**Business-day math (must port exactly — legacy `workingDayAfter`, lines 4952-4964):**

```
workingDayAfter(startDate, nWorkingDays):
  if nWorkingDays <= 1: return startDate        # Day 1 == the anchor date itself
  d = startDate; added = 1
  while added < nWorkingDays:
    d += 1 calendar day
    if d is not Sat(6) and not Sun(0): added += 1
  return d
```

- The working-day calendar is built by stepping forward from today, skipping
  `getDay()===0` (Sun) and `===6` (Sat) — legacy lines 4947-4951.
- Skipping weekends is gated by `SETTINGS.seqSkipWeekends` (default **true**). When false, use
  plain calendar offsets.
- `follow_up` for a contact is the computed date of their **next** sequence step from their
  anchor (enrolment date / `seqStarted`). `sequence_day` stores the current step's day number.
- **Callback outcome** (dialler, Phase 3) sets `follow_up = next business day` (legacy
  "tomorrow"). Use the same business-day helper.

**Phase 2 deliverable:** a pure, unit-tested `lib/sequences/` module implementing
`addBusinessDays(start, n, {skipWeekends})`, `workingDayAfter`, `nextSequenceStep(contact, seq)`,
and `nextSequenceDate(contact, seq)`. **No sending** — but `/queue` and `/sequences` consume it,
and `setFollowUp`/enrolment write the result. This is the highest-value pure-logic port and the
easiest to test against the 5-step golden case.

**[DECISION 6]** Sequence/step/template storage. Phase 1 only has `campaigns.sequence` (a text
identifier) — there is no table for step definitions or email templates. Options:
(a) Phase 2 migration adding `sequences`, `sequence_steps`, `templates` tables (org-scoped, RLS);
(b) store sequence+template JSON in a settings/jsonb blob for now and normalise later.
**Recommendation: (a)** — sequences and templates are first-class in the legacy app and Phase 5
(runner) needs them relational. Spec the migration as part of Phase 2 (`/sequences` CRUD is one of
the 12 views). If timeboxed, ship the tables read-mostly with a single hardcoded 5-step seed and
defer template editing.

### 3.4 Rhythm thresholds (cadence / staleness)

Legacy `SETTINGS` defaults (line 2900): `rhythmGreen:3, rhythmAmber:5, rhythmRed:7, rhythmNone:14`
(handover quotes 5/14/28/60 — values are **user-tunable**, so treat the schema as the contract and
the numbers as defaults). Logic (`getRhythmDays` line 2996, `isStale` line 2999,
`daysSinceLastTP` line 1997):

- `daysSinceLastTP(contact)` = floor(days since most-recent touchpoint); `9999` if none.
- A contact is **stale** when `daysSinceLastTP >= rhythm[status]` (the threshold for *its current
  status*), **except** `meeting`/`notinterested` are never stale, and a never-contacted contact
  with no status is stale ("never contacted").
- Drives a **badge/colour only** (`reminderBadge`: `>=10d` overdue, `>=5d` clock) — it does not
  mutate stored status (see DECISION 5).

**Phase 2 deliverable:** port `daysSinceLastTP` + `isStale` + `reminderBadge` as pure helpers in
`lib/rhythm/`, reading thresholds from org settings (§6). Used by Today + Pipeline badges.

---

## 4. Apollo CSV importer

Legacy parses CSV client-side (`parseCSV` line ~2350) and maps headers to fields via a
hint table (`CSV_FIELD_HINTS`, lines 2370-2392) with a manual column-mapping dialog
(`csvOpenMappingDialog`, line 2410) so the user can override auto-detection.

### 4.1 Recognised Apollo / generic columns → mapping

The legacy hint table (case-insensitive header match). Each target field lists the header
synonyms it matches:

| Target | Header synonyms (lower-cased match) | Phase 1 column |
|---|---|---|
| firstName | first name, firstname, first, given name, fname, forename | `first_name` |
| lastName | last name, lastname, surname, family name, lname | `last_name` |
| company | company, organisation, organization, employer, company name, account name, account, business | `company` |
| email | email, email address, e-mail, primary email, work email | `email` |
| emailStatus | email status, email confidence | `metadata.emailStatus` *(DECISION 4)* |
| mobile | mobile, mobile phone, cell, cell phone, cellphone, mobile number | `mobile` |
| phone | phone, phone number, direct phone, work phone, telephone, tel, office phone, company phone, work direct phone | `phone` |
| linkedin | linkedin, linkedin url, linkedin profile, linked in, person linkedin url, person linkedin | `linkedin` |
| website | website, web, url, company website, site | `metadata.website` |
| city | city, town, location, company city | `metadata.city` |
| country | country, nation | `country` |
| state | state, region, area, province, county | `metadata.state` |
| seniority | seniority, title, job title, role, position | `seniority` (and `job_title`) |
| industry | industry, sector, vertical | `metadata.industry` |
| employees | employees, # employees, employee count, company size, headcount, number of employees | `metadata.employees` |
| keywords | keywords, tags | `metadata.keywords` |
| technologies | technologies, tech stack, tools, software | `metadata.technologies` |
| annualRevenue | annual revenue, revenue, arr | `metadata.annualRevenue` |
| notes | notes, description, comments, about | `notes` |
| apolloAccountId | apollo account id, apollo_account_id, account id, organization id | `metadata.apolloAccountId` |
| apolloContactId | apollo contact id, apollo_id, apollo id, contact id, person id | `metadata.apolloContactId` |

`CSV_FIELDS` (line 2393) is the picklist the user chooses from in the mapping dialog, including
`(skip)` to ignore a column.

**Note on "seniority vs title":** the legacy hint folds *job title* synonyms under `seniority`.
Phase 2 should map the matched value into **both** `seniority` and `job_title` (or split: title →
`job_title`, leave `seniority` for an explicit "Seniority" column if Apollo provides one). Confirm
under DECISION 4.

### 4.2 Import behaviour

- **Server-side parse:** move CSV parsing/mapping to a Server Action (upload via form / pasted
  text). Reuse the legacy auto-detect hint table; allow the user to override the column→field
  mapping before commit (port the mapping dialog UX).
- **Target:** import into a chosen (or new) campaign; set `org_id`, `campaign_id`, `status='none'`.
- **Idempotency:** the migration provides `contacts (org_id, legacy_id)` unique index for
  service-role upsert. The Apollo importer runs as the *authenticated user* (not service role),
  so it must set `org_id` itself. **[DECISION 7]** dedup key for *CSV* imports: there is no
  `legacy_id` from Apollo. Options: dedup on `(org_id, email)` (add a partial unique index), or
  on `metadata.apolloContactId`, or allow duplicates and let the user merge. Recommend
  dedup-on-email with an "update existing / skip / insert anyway" choice in the mapping step.
- **Validation:** company required (matches `saveC`); rows missing it are flagged, not silently
  dropped. Report a summary: N inserted / M updated / K skipped (with reasons).
- **Size:** legacy handled a few thousand rows in-browser. Server action should batch inserts
  (e.g. 500/insert) and stay within request limits; for very large files consider chunked upload.

---

## 5. Proposed conventions for this codebase

### 5.1 Route structure (App Router)

```
app/
  today/page.tsx              # exists — extend with write actions
  pipeline/page.tsx           # exists — extend to full CRUD (all-campaign or active-campaign)
  campaigns/page.tsx          # NEW — campaign list + create/rename/delete
  campaigns/[id]/page.tsx     # NEW — one campaign's pipeline (contact table)
  contacts/[id]/page.tsx      # NEW — contact detail: fields + touchpoint timeline + actions
  activity/page.tsx           # NEW — cross-campaign touchpoint feed
  sequences/page.tsx          # NEW — sequence + step + template CRUD (DECISION 6)
  queue/page.tsx              # NEW — due-step preview per campaign (read-only; no send)
  send-activity/page.tsx      # NEW — recent email touchpoints (disk import deferred)
  reports/page.tsx            # NEW — score/funnel/report tabs (DECISION 1)
  settings/page.tsx           # NEW — org settings subset (§6)
  admin/page.tsx              # NEW — CSV import entry + danger-zone
```

Conventions (from CLAUDE.md / ADRs):
- Every auth-gated server page: `export const dynamic = 'force-dynamic';` (ADR 004).
- Imports via `@/*` alias; no `../../..`.
- `'use client'` only for interactive bits (forms, inline edit, mapping dialog).
- Reads via `lib/supabase/queries.ts` helpers (extend it). Writes via Server Actions.

### 5.2 Server Action naming & placement

- Co-locate per entity: `app/_actions/campaigns.ts`, `contacts.ts`, `touchpoints.ts`,
  `sequences.ts`, `import.ts`, `settings.ts` — each file starts with `'use server'`.
  **[DECISION 8]** confirm `app/_actions/` vs `lib/actions/` placement.
- Verb-first names: `createX / updateX / deleteX / listX / setX / logX / bulkSetStatus /
  importApolloCsv`. Each returns `{ ok: true, data } | { ok: false, error }`; validate input with
  Zod; call `revalidatePath` for affected routes.
- INSERTs set `org_id` (via the §2 DECISION 3 org-id helper). UPDATE/DELETE target by `id`,
  no `org_id` filter (RLS handles it).
- Read mappers (snake→camel) live in `lib/supabase/queries.ts` next to the existing
  `toCampaign`/`toContact`; add `toTouchpoint`.

### 5.3 First Phase 2 increment vs later

**Increment 1 (land first — unblocks daily use):**
1. Org-id helper (DECISION 3) + `app/_actions/` scaffold.
2. Contacts full CRUD + inline/bulk status + follow-up; Pipeline write-enabled.
3. Touchpoint logging (manual + "log email sent") on Today/Pipeline/detail; `/contacts/[id]`
   detail view.
4. Campaign CRUD + `/campaigns` and `/campaigns/[id]`.
5. Pure `lib/rhythm/` + staleness badges on Today/Pipeline.

**Increment 2:**
6. Apollo CSV importer (+ `metadata jsonb` migration, DECISION 4c) and `/admin` entry.
7. `lib/sequences/` business-day engine (unit-tested) + `/sequences` CRUD (+ migration,
   DECISION 6) + `/queue` preview.

**Increment 3 (lightweight, lower priority):**
8. `/activity` + `/send-activity` feeds.
9. `/reports` (score/funnel/report tabs).
10. `/settings` org settings.

Tests per CLAUDE.md: Vitest unit tests for `lib/sequences/` (5-step golden case + weekend skip)
and `lib/rhythm/`; Playwright e2e for the contact create→log-touchpoint→status-change happy path.

---

## 6. Settings (org-level)

Legacy `SETTINGS` is per-user localStorage. Phase 2 makes the **email/cadence subset** org-level.
**[DECISION 9]** new `org_settings` table (one row per org, RLS-scoped) vs a `jsonb` column on
`organizations`. Fields to carry now:

| Setting | Default | Used by |
|---|---|---|
| `daily_goal` | 30 | queue cap display |
| `weekly_calls_goal` / `weekly_emails_goal` | 50 / 150 | reports |
| `rhythm_green / amber / red / none` | 3 / 5 / 7 / 14 | staleness (§3.4) |
| `seq_skip_weekends` | true | sequence math (§3.3) |
| `signature` | "" | template rendering |
| `snippets` | [] | template editor helper |

**Parked** (later phases, do NOT add to settings now): all `tx*` Telnyx fields, `txWorkerUrl/Secret`,
`outlookSendLogPath`, `outreach_zoho_url`.

---

## 7. Open product decisions (consolidated)

1. Collapse Score/Funnel/Report into one `/reports` route with tabs? (§1)
2. Confirm route slugs `/send-activity`, `/queue`, `/reports`. (§1)
3. How to expose current org id for INSERTs (`getCurrentOrgId()` rpc/select vs session claim). (§2)
4. Apollo enrichment fields with no column: drop / notes / **add `contacts.metadata jsonb`** (rec). (§2.2, §4)
5. Status = manually-set, rhythm drives badge only (matches legacy)? (§3.1)
6. Sequence/step/template storage: **new relational tables (rec)** vs jsonb blob. (§3.3)
7. CSV dedup key (no `legacy_id` from Apollo): **dedup on `(org_id, email)` (rec)** vs apolloContactId vs allow-dupes. (§4.2)
8. Server Action placement: `app/_actions/` vs `lib/actions/`. (§5.2)
9. Org settings storage: `org_settings` table vs `organizations.settings jsonb`. (§6)

---

## 8. Acceptance criteria (Phase 2 "done")

- All 12 legacy views accounted for: 9 built as routes, dialler deferred (Phase 3/4),
  admin reduced to import + danger-zone, send-activity reduced to email-touchpoint feed.
- Contacts/campaigns/touchpoints fully CRUD via Server Actions; **zero** writes to
  IndexedDB/localStorage/disk.
- Status terminal-skip + meeting/notinterested staleness-exclusion rules enforced.
- Business-day sequence math ports the legacy `workingDayAfter` exactly; unit-tested against the
  5-step (Day 1/3/7/12/15) golden case with weekend skipping on and off.
- Apollo CSV import: upload → auto-mapped → user-overridable → committed to a campaign with a
  summary, dedup per DECISION 7.
- `make typecheck`, `make lint`, `make test`, `make test-e2e`, `make build` all green.
- Every new server page is `force-dynamic`; all DB access is RLS-scoped (no `org_id` filter on
  read/update/delete; `org_id` set on insert).
