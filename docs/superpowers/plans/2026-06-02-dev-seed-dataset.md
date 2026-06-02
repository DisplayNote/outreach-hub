# Dev Seed Dataset + E2E Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One command (`make seed`) fills the local dev DB with a realistic, full-coverage dataset (and live Mailpit replies), wipes the `E2E *` clutter, and stops it recurring.

**Architecture:** A pure dataset module (`scripts/seed/dataset.mjs`) defines an in-memory graph keyed by string ids + a `validateDataset()` guard. A service-role seeder (`scripts/seed-dev.mjs`, modelled on `scripts/import-legacy.mjs`) is localhost-guarded, ensures the lazily-created dev org, wipes dev + E2E rows, resolves keys→UUIDs, and inserts in FK order. A best-effort Mailpit injector (`scripts/seed-inbox.mjs`) SMTP-delivers reply messages that the scanner correlates by sender address. E2E specs gain `afterAll` cleanup.

**Tech Stack:** Node ESM scripts, `@supabase/supabase-js` (service role), `nodemailer` (→ Mailpit `:1025`), Vitest, Playwright, Make.

**Key facts the executor must respect:**
- The dev user/org (`dev@outreach.local` / "Dev Org") is created lazily by `/auth/mock` via the `on_auth_user_created` trigger. The seeder creates the auth user (idempotent) then resolves `org_id` from `public.users` — it does **not** rely on `seed.sql`.
- Service-role client bypasses RLS (required). A **localhost-only guard** is the hard stop against ever writing a remote project.
- Enums: `contact_status` = `none|amber|red|green|meeting|notinterested|bounced`; `touchpoint_channel` = `email|phone|linkedin|other`; `email_events.type` = `sent|reply|bounce`; `suppressions.reason` = `replied|bounced|manual|unsubscribed`.
- Composite FKs require `org_id` on every child insert: `contacts(id,org_id)`, `campaigns(id,org_id)`, `sequences(id,org_id)`; `sequence_steps`→(sequence_id,org_id)+(template_id,org_id); `email_events`→(contact_id,org_id)+(campaign_id,org_id).
- `suppressions` is unique on `(org_id, email)`; `email_events` is unique on `(org_id, provider, message_id)`; `touchpoints.legacy_id` is `text`.
- Live inbound via Mailpit: a **reply** correlates by **sender address** to a prior `sent` event (the Mailpit driver sets only `from/to/subject/receivedAt/bodyText`). A **bounce** needs `failedRecipient`, which Mailpit never recovers → bounces are tested via the in-app **Sim bounce** button (mock driver), not Mailpit.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `scripts/seed/dataset.mjs` (new) | Pure data graph (templates→sequences→campaigns→contacts→touchpoints→emailEvents→suppressions→userSettings + mailpitReplies) keyed by strings; `validateDataset()`. No DB, no time calls. |
| `scripts/seed/dates.mjs` (new) | Tiny pure date helpers (`addDays`, `isoDate`, `isoAt`) shared by the seeder. |
| `scripts/seed-dev.mjs` (new) | Service-role DB seeder: guard → ensure user/org → wipe dev+E2E → resolve keys→UUIDs → insert in FK order → summary. |
| `scripts/seed-inbox.mjs` (new) | Best-effort Mailpit reply injector via nodemailer. |
| `tests/unit/seed/dataset.test.ts` (new) | Asserts `validateDataset()` passes and coverage invariants hold. |
| `tests/e2e/amd-run.spec.ts` (modify) | Add `afterAll` deleting `E2E AMD Campaign` + its contacts. |
| `tests/e2e/dialler-autodial.spec.ts` (modify) | Add `afterAll` deleting `E2E AutoDial Campaign` + its contacts. |
| `Makefile` (modify) | `seed` + `seed-inbox` targets; `.PHONY` + `help`. |
| `docs/development.md` (modify) | "Seeding dev data" section. |

---

## Task 1: Pure date helpers

**Files:**
- Create: `scripts/seed/dates.mjs`
- Test: covered indirectly by Task 2's dataset test (these are trivial pure fns)

- [ ] **Step 1: Create `scripts/seed/dates.mjs`**

```js
// scripts/seed/dates.mjs
// Tiny pure date helpers for the dev seeder. Kept separate so dataset.mjs stays
// time-free (deterministic + unit-testable): the dataset stores integer day
// OFFSETS, and the seeder resolves them against a single `now` captured at run.

/** Return a new Date `days` after `base` (negative = before). */
export function addDays(base, days) {
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** `YYYY-MM-DD` (UTC) — for date columns like contacts.follow_up. */
export function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

/** Full ISO timestamp (UTC) — for timestamptz columns like occurred_at. */
export function isoAt(date) {
  return date.toISOString();
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/seed/dates.mjs
git commit -m "feat(seed): add pure date helpers for the dev seeder"
```

---

## Task 2: Pure dataset module + validation, test-first

**Files:**
- Create: `scripts/seed/dataset.mjs`
- Test: `tests/unit/seed/dataset.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/seed/dataset.test.ts
import { describe, it, expect } from 'vitest';
// dataset.mjs is plain ESM data — import works directly under Vitest.
import {
  ENUMS,
  templates,
  sequences,
  campaigns,
  contacts,
  touchpoints,
  emailEvents,
  suppressions,
  userSettings,
  mailpitReplies,
  validateDataset,
} from '../../../scripts/seed/dataset.mjs';

describe('seed dataset', () => {
  it('passes validateDataset() with no errors', () => {
    expect(() => validateDataset()).not.toThrow();
  });

  it('covers every contact_status at least once', () => {
    const present = new Set(contacts.map((c) => c.status));
    for (const status of ENUMS.status) {
      expect(present.has(status), `missing status: ${status}`).toBe(true);
    }
  });

  it('has at least one contact due today and one overdue', () => {
    expect(contacts.some((c) => c.followUpOffsetDays === 0)).toBe(true);
    expect(contacts.some((c) => typeof c.followUpOffsetDays === 'number' && c.followUpOffsetDays < 0)).toBe(true);
  });

  it('has exactly one deliberately unlinked campaign', () => {
    expect(campaigns.filter((c) => c.sequenceKey === null)).toHaveLength(1);
  });

  it('every email sequence step references an existing template', () => {
    const templateKeys = new Set(templates.map((t) => t.key));
    for (const seq of sequences) {
      for (const step of seq.steps) {
        if (step.channel === 'email') {
          expect(step.templateKey, `email step in ${seq.key} needs a template`).not.toBeNull();
          expect(templateKeys.has(step.templateKey)).toBe(true);
        }
      }
    }
  });

  it('every reply/bounce event has a matching sent event for the same contact', () => {
    const sentByContact = new Set(
      emailEvents.filter((e) => e.type === 'sent').map((e) => e.contactKey),
    );
    for (const ev of emailEvents.filter((e) => e.type !== 'sent')) {
      expect(sentByContact.has(ev.contactKey), `${ev.type} for ${ev.contactKey} has no prior sent`).toBe(true);
    }
  });

  it('every mailpit reply targets a contact that has a sent event (so it correlates)', () => {
    const sentByContact = new Set(
      emailEvents.filter((e) => e.type === 'sent').map((e) => e.contactKey),
    );
    expect(mailpitReplies.length).toBeGreaterThan(0);
    for (const r of mailpitReplies) {
      expect(sentByContact.has(r.contactKey), `mailpit reply for ${r.contactKey} needs a sent event`).toBe(true);
    }
  });

  it('exposes user settings with goals', () => {
    expect(userSettings.dailyGoal).toBeGreaterThan(0);
    expect(Array.isArray(userSettings.noteSnippets)).toBe(true);
    expect(suppressions.length).toBeGreaterThan(0);
    expect(touchpoints.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/unit/seed/dataset.test.ts`
Expected: FAIL — `Cannot find module '../../../scripts/seed/dataset.mjs'`.

- [ ] **Step 3: Create `scripts/seed/dataset.mjs`**

```js
// scripts/seed/dataset.mjs
//
// PURE dev-seed dataset: an in-memory object graph cross-referenced by string
// keys (NOT uuids) so it's readable and testable without a database. The seeder
// (scripts/seed-dev.mjs) resolves keys -> real uuids at insert time and converts
// the integer day OFFSETS here into concrete dates/timestamps against a single
// `now`. No Date/Math.random calls live here — keep it deterministic.
//
// Graph: templates -> sequences(+steps) -> campaigns -> contacts
//        -> touchpoints / emailEvents / suppressions ; plus userSettings and
//        mailpitReplies (live inbound for the Mailpit path).

export const ENUMS = {
  status: ['none', 'amber', 'red', 'green', 'meeting', 'notinterested', 'bounced'],
  channel: ['email', 'phone', 'linkedin', 'other'],
  eventType: ['sent', 'reply', 'bounce'],
  suppressionReason: ['replied', 'bounced', 'manual', 'unsubscribed'],
};

export const templates = [
  {
    key: 'intro',
    name: 'Intro — first touch',
    subject: 'Quick idea for {company}',
    body: 'Hi {firstName},\n\nI work with teams like {company} on classroom & meeting-room display tooling. Worth a quick chat?\n\nBest,\nPaul',
  },
  {
    key: 'follow1',
    name: 'Follow-up #1',
    subject: 'Re: Quick idea for {company}',
    body: 'Hi {firstName},\n\nCircling back — happy to send a 2-minute overview if useful.\n\nPaul',
  },
  {
    key: 'follow2',
    name: 'Follow-up #2',
    subject: 'One more thought for {company}',
    body: 'Hi {firstName},\n\nA few {company}-style orgs saw real savings. Open to a look?\n\nPaul',
  },
  {
    key: 'breakup',
    name: 'Break-up',
    subject: 'Closing the loop',
    body: 'Hi {firstName},\n\nI’ll stop here so I’m not a nuisance — just reply if the timing changes.\n\nPaul',
  },
  {
    key: 'reengage',
    name: 'Re-engagement',
    subject: 'Still on your radar, {firstName}?',
    body: 'Hi {firstName},\n\nWe spoke a while back about {company}. Lots has shipped since — reconnect?\n\nPaul',
  },
  {
    key: 'meeting',
    name: 'Meeting confirm',
    subject: 'Confirmed: our chat',
    body: 'Hi {firstName},\n\nLooking forward to it. Invite to follow.\n\nPaul',
  },
];

export const sequences = [
  {
    key: 'msp',
    name: 'MSP Cold Outreach',
    steps: [
      { order: 1, dayOffset: 0, channel: 'email', templateKey: 'intro' },
      { order: 2, dayOffset: 3, channel: 'email', templateKey: 'follow1' },
      { order: 3, dayOffset: 5, channel: 'linkedin', templateKey: null },
      { order: 4, dayOffset: 7, channel: 'email', templateKey: 'follow2' },
      { order: 5, dayOffset: 14, channel: 'email', templateKey: 'breakup' },
    ],
  },
  {
    key: 'reengage',
    name: 'Re-engagement',
    steps: [
      { order: 1, dayOffset: 0, channel: 'email', templateKey: 'reengage' },
      { order: 2, dayOffset: 4, channel: 'linkedin', templateKey: null },
      { order: 3, dayOffset: 9, channel: 'email', templateKey: 'breakup' },
    ],
  },
  {
    key: 'event',
    name: 'Event Follow-up',
    steps: [
      { order: 1, dayOffset: 0, channel: 'email', templateKey: 'intro' },
      { order: 2, dayOffset: 2, channel: 'email', templateKey: 'follow1' },
    ],
  },
];

export const campaigns = [
  { key: 'msp_q2', name: 'UK MSP Q2 2026', sequenceKey: 'msp' },
  { key: 'edu', name: 'Education EMEA', sequenceKey: 'msp' },
  { key: 'dormant', name: 'Re-engagement — Dormant 2025', sequenceKey: 'reengage' },
  // Deliberately unlinked: exercises the queue's "Not linked — set it" state.
  { key: 'bett', name: 'Event — BETT 2026 Leads', sequenceKey: null },
];

// Contacts. `followUpOffsetDays`: negative = overdue, 0 = due today, positive =
// future, null = not enrolled. `sequenceDay` mirrors a step's day_offset (or
// null). Phones populated on a subset (dialler-ready). Keys are referenced by
// touchpoints/emailEvents/suppressions/mailpitReplies below.
export const contacts = [
  // --- UK MSP Q2 2026: active mid-sequence + due/overdue --------------------
  { key: 'mike', campaignKey: 'msp_q2', firstName: 'Mike', lastName: 'Galkin', email: 'mike.galkin@example.com', company: 'FlutterUKI', phone: '+441234567890', mobile: '+447700900123', jobTitle: 'Director, IT', seniority: 'Director', country: 'United Kingdom', linkedin: 'https://www.linkedin.com/in/mike-galkin/', status: 'amber', sequenceDay: 3, followUpOffsetDays: 0, notes: 'Asked to follow up after budget review.' },
  { key: 'sara', campaignKey: 'msp_q2', firstName: 'Sara', lastName: 'Lopez', email: 'sara.lopez@example.com', company: 'NorthBridge MSP', phone: '+441611112222', mobile: '+447700900456', jobTitle: 'Head of Ops', seniority: 'Head', country: 'United Kingdom', linkedin: 'https://www.linkedin.com/in/sara-lopez/', status: 'red', sequenceDay: 7, followUpOffsetDays: -2, notes: 'Went quiet after step 3.' },
  { key: 'tomh', campaignKey: 'msp_q2', firstName: 'Tom', lastName: 'Harding', email: 'tom.harding@example.com', company: 'Cardinal Systems', phone: '+441189998888', mobile: null, jobTitle: 'IT Manager', seniority: 'Manager', country: 'United Kingdom', linkedin: null, status: 'amber', sequenceDay: 0, followUpOffsetDays: 0, notes: null },
  { key: 'greenwin', campaignKey: 'msp_q2', firstName: 'Priya', lastName: 'Nair', email: 'priya.nair@example.com', company: 'Helix Cloud', phone: '+441990001111', mobile: '+447700900789', jobTitle: 'CTO', seniority: 'C-level', country: 'United Kingdom', linkedin: 'https://www.linkedin.com/in/priya-nair/', status: 'green', sequenceDay: 7, followUpOffsetDays: 5, notes: 'Replied positively — sent calendar link.' },
  { key: 'meetingset', campaignKey: 'msp_q2', firstName: 'Dan', lastName: 'OBrien', email: 'dan.obrien@example.com', company: 'Brightwave', phone: '+441222333444', mobile: '+447700900222', jobTitle: 'Director', seniority: 'Director', country: 'Ireland', linkedin: null, status: 'meeting', sequenceDay: 3, followUpOffsetDays: 3, notes: 'Demo booked Thursday.' },
  { key: 'bounced1', campaignKey: 'msp_q2', firstName: 'Carl', lastName: 'Vesely', email: 'carl.vesely@bademail.example.com', company: 'Vesely IT', phone: null, mobile: null, jobTitle: 'Owner', seniority: 'Owner', country: 'United Kingdom', linkedin: null, status: 'bounced', sequenceDay: 0, followUpOffsetDays: null, notes: 'Hard bounce on first send.' },
  { key: 'notint1', campaignKey: 'msp_q2', firstName: 'Grace', lastName: 'Field', email: 'grace.field@example.com', company: 'Fieldworks', phone: '+441333444555', mobile: null, jobTitle: 'Ops Lead', seniority: 'Lead', country: 'United Kingdom', linkedin: null, status: 'notinterested', sequenceDay: 3, followUpOffsetDays: null, notes: 'Said not now, try Q4.' },

  // --- Education EMEA: mix incl. future + fresh ------------------------------
  { key: 'amaia', campaignKey: 'edu', firstName: 'Amaia', lastName: 'Etxe', email: 'amaia.etxe@example.com', company: 'Bilbao School Trust', phone: '+34600111222', mobile: '+34600333444', jobTitle: 'Head of Digital', seniority: 'Head', country: 'Spain', linkedin: 'https://www.linkedin.com/in/amaia-etxe/', status: 'amber', sequenceDay: 0, followUpOffsetDays: 1, notes: null },
  { key: 'lars', campaignKey: 'edu', firstName: 'Lars', lastName: 'Holm', email: 'lars.holm@example.com', company: 'Aarhus EdTech', phone: '+4520304050', mobile: null, jobTitle: 'IT Coordinator', seniority: 'Coordinator', country: 'Denmark', linkedin: null, status: 'none', sequenceDay: null, followUpOffsetDays: null, notes: 'Imported, not yet enrolled.' },
  { key: 'mei', campaignKey: 'edu', firstName: 'Mei', lastName: 'Tanaka', email: 'mei.tanaka@example.com', company: 'Kyoto Learning', phone: '+81312345678', mobile: '+819012345678', jobTitle: 'Procurement', seniority: 'Manager', country: 'Japan', linkedin: null, status: 'amber', sequenceDay: 3, followUpOffsetDays: -1, notes: null },
  { key: 'pablo', campaignKey: 'edu', firstName: 'Pablo', lastName: 'Ruiz', email: 'pablo.ruiz@example.com', company: 'Madrid Polytechnic', phone: '+34611222333', mobile: null, jobTitle: 'Dean', seniority: 'Dean', country: 'Spain', linkedin: 'https://www.linkedin.com/in/pablo-ruiz/', status: 'red', sequenceDay: 14, followUpOffsetDays: -5, notes: 'Last step, no response.' },
  { key: 'green2', campaignKey: 'edu', firstName: 'Nora', lastName: 'Berg', email: 'nora.berg@example.com', company: 'Oslo Schools', phone: '+4791020304', mobile: '+4791020305', jobTitle: 'CIO', seniority: 'C-level', country: 'Norway', linkedin: null, status: 'green', sequenceDay: 3, followUpOffsetDays: 7, notes: 'Warm — wants a pilot.' },

  // --- Re-engagement — Dormant 2025 -----------------------------------------
  { key: 'oldjon', campaignKey: 'dormant', firstName: 'Jon', lastName: 'Price', email: 'jon.price@example.com', company: 'Price & Co', phone: '+441444555666', mobile: null, jobTitle: 'MD', seniority: 'MD', country: 'United Kingdom', linkedin: null, status: 'amber', sequenceDay: 0, followUpOffsetDays: 0, notes: '2024 lead, reopening.' },
  { key: 'oldkate', campaignKey: 'dormant', firstName: 'Kate', lastName: 'Singh', email: 'kate.singh@example.com', company: 'Singh Digital', phone: '+441555666777', mobile: '+447700900999', jobTitle: 'Founder', seniority: 'Founder', country: 'United Kingdom', linkedin: 'https://www.linkedin.com/in/kate-singh/', status: 'red', sequenceDay: 4, followUpOffsetDays: -3, notes: null },
  { key: 'notint2', campaignKey: 'dormant', firstName: 'Ed', lastName: 'Mason', email: 'ed.mason@example.com', company: 'Mason Group', phone: null, mobile: null, jobTitle: 'COO', seniority: 'C-level', country: 'United Kingdom', linkedin: null, status: 'notinterested', sequenceDay: 9, followUpOffsetDays: null, notes: 'Unsubscribed politely.' },
  { key: 'bounced2', campaignKey: 'dormant', firstName: 'Wendy', lastName: 'Ash', email: 'wendy.ash@nodomain.example.com', company: 'Ash Ltd', phone: null, mobile: null, jobTitle: 'Owner', seniority: 'Owner', country: 'United Kingdom', linkedin: null, status: 'bounced', sequenceDay: 0, followUpOffsetDays: null, notes: null },

  // --- Event — BETT 2026 Leads (unlinked campaign; fresh imports) -----------
  { key: 'bett1', campaignKey: 'bett', firstName: 'Olu', lastName: 'Ade', email: 'olu.ade@example.com', company: 'Lagos Academies', phone: '+2348012345678', mobile: null, jobTitle: 'Director', seniority: 'Director', country: 'Nigeria', linkedin: null, status: 'none', sequenceDay: null, followUpOffsetDays: null, notes: 'Stand visitor.' },
  { key: 'bett2', campaignKey: 'bett', firstName: 'Hana', lastName: 'Kim', email: 'hana.kim@example.com', company: 'Seoul Ed', phone: '+821012345678', mobile: '+821087654321', jobTitle: 'Manager', seniority: 'Manager', country: 'South Korea', linkedin: 'https://www.linkedin.com/in/hana-kim/', status: 'none', sequenceDay: null, followUpOffsetDays: null, notes: 'Badge scan.' },
];

// Touchpoints: a few per active contact, spread over recent weeks. `daysAgo`
// (>=0) is converted to occurred_at by the seeder. `legacyId` (text) makes them
// idempotent under the seeder's wipe-then-insert.
export const touchpoints = [
  { key: 'tp-mike-1', contactKey: 'mike', channel: 'email', note: 'Sent intro.', daysAgo: 7 },
  { key: 'tp-mike-2', contactKey: 'mike', channel: 'email', note: 'Sent follow-up #1.', daysAgo: 4 },
  { key: 'tp-mike-3', contactKey: 'mike', channel: 'phone', note: 'Left voicemail.', daysAgo: 2 },
  { key: 'tp-sara-1', contactKey: 'sara', channel: 'email', note: 'Sent intro.', daysAgo: 12 },
  { key: 'tp-sara-2', contactKey: 'sara', channel: 'linkedin', note: 'Connection request.', daysAgo: 9 },
  { key: 'tp-priya-1', contactKey: 'greenwin', channel: 'email', note: 'Sent intro.', daysAgo: 9 },
  { key: 'tp-priya-2', contactKey: 'greenwin', channel: 'email', note: 'Positive reply — sent calendar link.', daysAgo: 2 },
  { key: 'tp-dan-1', contactKey: 'meetingset', channel: 'email', note: 'Sent intro.', daysAgo: 6 },
  { key: 'tp-dan-2', contactKey: 'meetingset', channel: 'phone', note: 'Booked demo.', daysAgo: 1 },
  { key: 'tp-pablo-1', contactKey: 'pablo', channel: 'email', note: 'Sequence completed, no reply.', daysAgo: 3 },
  { key: 'tp-nora-1', contactKey: 'green2', channel: 'email', note: 'Wants a pilot.', daysAgo: 2 },
];

// Email events. `daysAgo` -> occurred_at. `messageId` is deterministic so the
// seeder can keep (org,provider,message_id) unique and Mailpit replies can
// (optionally) thread to a sent id. Reply/bounce rows mirror what the scanner
// would have produced for green/meeting/bounced contacts.
export const emailEvents = [
  // sent history
  { contactKey: 'mike', campaignKey: 'msp_q2', type: 'sent', messageId: 'seed-sent-mike-1', subject: 'Quick idea for FlutterUKI', sequenceDay: 0, daysAgo: 7 },
  { contactKey: 'mike', campaignKey: 'msp_q2', type: 'sent', messageId: 'seed-sent-mike-2', subject: 'Re: Quick idea for FlutterUKI', sequenceDay: 3, daysAgo: 4 },
  { contactKey: 'sara', campaignKey: 'msp_q2', type: 'sent', messageId: 'seed-sent-sara-1', subject: 'Quick idea for NorthBridge MSP', sequenceDay: 0, daysAgo: 12 },
  { contactKey: 'greenwin', campaignKey: 'msp_q2', type: 'sent', messageId: 'seed-sent-priya-1', subject: 'Quick idea for Helix Cloud', sequenceDay: 0, daysAgo: 9 },
  { contactKey: 'meetingset', campaignKey: 'msp_q2', type: 'sent', messageId: 'seed-sent-dan-1', subject: 'Quick idea for Brightwave', sequenceDay: 0, daysAgo: 6 },
  { contactKey: 'bounced1', campaignKey: 'msp_q2', type: 'sent', messageId: 'seed-sent-carl-1', subject: 'Quick idea for Vesely IT', sequenceDay: 0, daysAgo: 8 },
  { contactKey: 'pablo', campaignKey: 'edu', type: 'sent', messageId: 'seed-sent-pablo-1', subject: 'Quick idea for Madrid Polytechnic', sequenceDay: 0, daysAgo: 18 },
  { contactKey: 'green2', campaignKey: 'edu', type: 'sent', messageId: 'seed-sent-nora-1', subject: 'Quick idea for Oslo Schools', sequenceDay: 0, daysAgo: 6 },
  { contactKey: 'bounced2', campaignKey: 'dormant', type: 'sent', messageId: 'seed-sent-wendy-1', subject: 'Still on your radar, Wendy?', sequenceDay: 0, daysAgo: 10 },
  // replies (green/meeting)
  { contactKey: 'greenwin', campaignKey: 'msp_q2', type: 'reply', messageId: 'seed-reply-priya-1', subject: 'Re: Quick idea for Helix Cloud', sequenceDay: null, daysAgo: 2 },
  { contactKey: 'meetingset', campaignKey: 'msp_q2', type: 'reply', messageId: 'seed-reply-dan-1', subject: 'Re: Quick idea for Brightwave', sequenceDay: null, daysAgo: 1 },
  { contactKey: 'green2', campaignKey: 'edu', type: 'reply', messageId: 'seed-reply-nora-1', subject: 'Re: Quick idea for Oslo Schools', sequenceDay: null, daysAgo: 2 },
  // bounces
  { contactKey: 'bounced1', campaignKey: 'msp_q2', type: 'bounce', messageId: 'seed-bounce-carl-1', subject: 'Undeliverable: Quick idea for Vesely IT', sequenceDay: null, daysAgo: 8 },
  { contactKey: 'bounced2', campaignKey: 'dormant', type: 'bounce', messageId: 'seed-bounce-wendy-1', subject: 'Undeliverable: Still on your radar, Wendy?', sequenceDay: null, daysAgo: 10 },
];

// Suppressions: one per reason. Email is normalised lower+trim by the seeder.
export const suppressions = [
  { contactKey: 'greenwin', email: 'priya.nair@example.com', reason: 'replied' },
  { contactKey: 'meetingset', email: 'dan.obrien@example.com', reason: 'replied' },
  { contactKey: 'bounced1', email: 'carl.vesely@bademail.example.com', reason: 'bounced' },
  { contactKey: 'bounced2', email: 'wendy.ash@nodomain.example.com', reason: 'bounced' },
  { contactKey: 'notint2', email: 'ed.mason@example.com', reason: 'unsubscribed' },
  { contactKey: 'notint1', email: 'grace.field@example.com', reason: 'manual' },
];

export const userSettings = {
  dailyGoal: 20,
  weeklyCallsGoal: 60,
  weeklyEmailsGoal: 150,
  rhythmGreen: 7,
  rhythmAmber: 14,
  rhythmRed: 30,
  rhythmNone: 60,
  signature: 'Paul Murphy\nDisplayNote — Outreach',
  noteSnippets: ['Left voicemail', 'Sent pricing', 'Asked to follow up next quarter'],
  txSipUser: 'paul.dev',
  txCallerId: '+441234000000',
  diallerInterCallDelaySec: 8,
  diallerAutoDial: false,
  diallerSynthTones: true,
};

// Live inbound for the Mailpit path (scripts/seed-inbox.mjs). Each becomes an
// SMTP message From the contact's address; the scanner classifies it a reply
// (non-system sender, non-NDR subject) and correlates by sender to the contact's
// sent event. Targets are amber/red contacts WITH a sent event and no existing
// reply/suppression, so a live Scan visibly flips them.
export const mailpitReplies = [
  { contactKey: 'mike', subject: 'Re: Quick idea for FlutterUKI', body: 'Thanks — yes, let’s find time next week.' },
  { contactKey: 'sara', subject: 'Re: Quick idea for NorthBridge MSP', body: 'Sorry for the delay! Still interested.' },
];

// --- Validation --------------------------------------------------------------

/**
 * Throw if the dataset graph is internally inconsistent. Pure: no DB, no IO.
 * Returns a per-collection count summary on success (handy for logs/tests).
 */
export function validateDataset() {
  const errors = [];
  const templateKeys = new Set(templates.map((t) => t.key));
  const sequenceKeys = new Set(sequences.map((s) => s.key));
  const campaignKeys = new Set(campaigns.map((c) => c.key));
  const contactKeys = new Set(contacts.map((c) => c.key));

  const dupe = (label, keys) => {
    const seen = new Set();
    for (const k of keys) {
      if (seen.has(k)) errors.push(`duplicate ${label} key: ${k}`);
      seen.add(k);
    }
  };
  dupe('template', templates.map((t) => t.key));
  dupe('sequence', sequences.map((s) => s.key));
  dupe('campaign', campaigns.map((c) => c.key));
  dupe('contact', contacts.map((c) => c.key));

  for (const seq of sequences) {
    for (const step of seq.steps) {
      if (!ENUMS.channel.includes(step.channel)) errors.push(`bad channel ${step.channel} in ${seq.key}`);
      if (step.channel === 'email' && (step.templateKey === null || !templateKeys.has(step.templateKey))) {
        errors.push(`email step ${seq.key}#${step.order} needs a valid template`);
      }
      if (step.templateKey !== null && !templateKeys.has(step.templateKey)) {
        errors.push(`step ${seq.key}#${step.order} references missing template ${step.templateKey}`);
      }
    }
  }

  for (const c of campaigns) {
    if (c.sequenceKey !== null && !sequenceKeys.has(c.sequenceKey)) {
      errors.push(`campaign ${c.key} references missing sequence ${c.sequenceKey}`);
    }
  }

  for (const c of contacts) {
    if (!campaignKeys.has(c.campaignKey)) errors.push(`contact ${c.key} references missing campaign ${c.campaignKey}`);
    if (!ENUMS.status.includes(c.status)) errors.push(`contact ${c.key} has bad status ${c.status}`);
  }

  const sentByContact = new Set(emailEvents.filter((e) => e.type === 'sent').map((e) => e.contactKey));
  for (const ev of emailEvents) {
    if (!ENUMS.eventType.includes(ev.type)) errors.push(`event for ${ev.contactKey} has bad type ${ev.type}`);
    if (!contactKeys.has(ev.contactKey)) errors.push(`event references missing contact ${ev.contactKey}`);
    if (!campaignKeys.has(ev.campaignKey)) errors.push(`event references missing campaign ${ev.campaignKey}`);
    if (ev.type !== 'sent' && !sentByContact.has(ev.contactKey)) {
      errors.push(`${ev.type} for ${ev.contactKey} has no prior sent event`);
    }
  }

  for (const tp of touchpoints) {
    if (!contactKeys.has(tp.contactKey)) errors.push(`touchpoint references missing contact ${tp.contactKey}`);
    if (!ENUMS.channel.includes(tp.channel)) errors.push(`touchpoint ${tp.key} bad channel ${tp.channel}`);
  }

  for (const s of suppressions) {
    if (!contactKeys.has(s.contactKey)) errors.push(`suppression references missing contact ${s.contactKey}`);
    if (!ENUMS.suppressionReason.includes(s.reason)) errors.push(`suppression bad reason ${s.reason}`);
  }

  for (const r of mailpitReplies) {
    if (!contactKeys.has(r.contactKey)) errors.push(`mailpit reply references missing contact ${r.contactKey}`);
    if (!sentByContact.has(r.contactKey)) errors.push(`mailpit reply ${r.contactKey} has no sent event to correlate`);
  }

  if (errors.length > 0) {
    throw new Error(`dataset validation failed:\n - ${errors.join('\n - ')}`);
  }

  return {
    templates: templates.length,
    sequences: sequences.length,
    sequenceSteps: sequences.reduce((n, s) => n + s.steps.length, 0),
    campaigns: campaigns.length,
    contacts: contacts.length,
    touchpoints: touchpoints.length,
    emailEvents: emailEvents.length,
    suppressions: suppressions.length,
    mailpitReplies: mailpitReplies.length,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/unit/seed/dataset.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/seed/dataset.mjs tests/unit/seed/dataset.test.ts
git commit -m "feat(seed): pure dev dataset graph + validation with unit coverage"
```

---

## Task 3: DB seeder

**Files:**
- Create: `scripts/seed-dev.mjs`

- [ ] **Step 1: Create `scripts/seed-dev.mjs`**

```js
#!/usr/bin/env node
// scripts/seed-dev.mjs
//
// Re-runnable LOCAL dev seeder. Fills the dev org with a realistic, full-coverage
// dataset (scripts/seed/dataset.mjs) and removes the `E2E *` clutter that e2e
// runs leave behind. Idempotent: wipe-then-insert scoped to the dev org.
//
// Uses the SERVICE ROLE key (bypasses RLS) and is HARD-GUARDED to localhost so it
// can never touch a remote/prod project.
//
// Usage (via `make seed`, which loads .env.local first):
//   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
//   SUPABASE_SERVICE_ROLE_KEY=<local service role key> \
//     node scripts/seed-dev.mjs

import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  templates,
  sequences,
  campaigns,
  contacts,
  touchpoints,
  emailEvents,
  suppressions,
  userSettings,
  validateDataset,
} from './seed/dataset.mjs';
import { addDays, isoDate, isoAt } from './seed/dates.mjs';

const DEV_EMAIL = 'dev@outreach.local';
const DEV_PASSWORD = 'dev-password-12345'; // matches app/auth/mock/route.ts
const PROVIDER = 'mock';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_SERVER_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function die(msg) {
  console.error(`seed-dev: ${msg}`);
  process.exit(1);
}

// --- Localhost guard (hard stop against seeding a remote project) ------------
if (!url) die('NEXT_PUBLIC_SUPABASE_URL is not set');
if (!serviceKey) die('SUPABASE_SERVICE_ROLE_KEY is not set');
{
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    die(`could not parse NEXT_PUBLIC_SUPABASE_URL: ${url}`);
  }
  if (host !== '127.0.0.1' && host !== 'localhost') {
    die(`refusing to run against non-local host "${host}". This script is LOCAL-ONLY.`);
  }
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function ensureDevOrg() {
  // Create the mock dev user if absent (the on_auth_user_created trigger then
  // makes its org + public.users row). Ignore "already registered".
  const { error: createErr } = await admin.auth.admin.createUser({
    email: DEV_EMAIL,
    password: DEV_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Dev User', org_name: 'Dev Org' },
  });
  if (createErr && createErr.code !== 'email_exists') {
    die(`could not ensure dev user: ${createErr.message}`);
  }
  const { data: rows, error } = await admin
    .from('users')
    .select('id, org_id')
    .eq('email', DEV_EMAIL)
    .limit(1);
  if (error) die(`could not read dev user: ${error.message}`);
  const row = rows?.[0];
  if (!row) die('dev user has no public.users row yet — sign in via /auth/mock once, then re-run');
  return { userId: row.id, orgId: row.org_id };
}

async function wipe(orgId, userId) {
  // Child-first within the dev org (most tables cascade from contacts/campaigns,
  // but delete explicitly so re-runs are clean regardless of cascade config).
  for (const table of ['suppressions', 'email_events', 'touchpoints', 'contacts', 'sequence_steps', 'sequences', 'templates', 'campaigns']) {
    const { error } = await admin.from(table).delete().eq('org_id', orgId);
    if (error) die(`wipe ${table} failed: ${error.message}`);
  }
  await admin.from('user_settings').delete().eq('user_id', userId);

  // Belt-and-braces: clear E2E-named rows globally in case e2e used another org.
  await admin.from('contacts').delete().like('company', 'E2E %');
  await admin.from('campaigns').delete().like('name', 'E2E %');
  await admin.from('sequences').delete().like('name', 'E2E %');
  await admin.from('templates').delete().like('name', 'E2E %');
}

async function insertAll(orgId, userId) {
  const now = new Date();

  // templates
  const templateId = new Map();
  for (const t of templates) {
    const id = randomUUID();
    templateId.set(t.key, id);
    const { error } = await admin.from('templates').insert({ id, org_id: orgId, name: t.name, subject: t.subject, body: t.body });
    if (error) die(`insert template ${t.key}: ${error.message}`);
  }

  // sequences + steps
  const sequenceId = new Map();
  for (const s of sequences) {
    const id = randomUUID();
    sequenceId.set(s.key, id);
    const { error } = await admin.from('sequences').insert({ id, org_id: orgId, name: s.name });
    if (error) die(`insert sequence ${s.key}: ${error.message}`);
    for (const step of s.steps) {
      const { error: stepErr } = await admin.from('sequence_steps').insert({
        id: randomUUID(), org_id: orgId, sequence_id: id,
        step_order: step.order, day_offset: step.dayOffset, channel: step.channel,
        template_id: step.templateKey ? templateId.get(step.templateKey) : null,
      });
      if (stepErr) die(`insert step ${s.key}#${step.order}: ${stepErr.message}`);
    }
  }

  // campaigns (set both sequence_id and the denormalised display name)
  const campaignId = new Map();
  for (const c of campaigns) {
    const id = randomUUID();
    campaignId.set(c.key, id);
    const seq = c.sequenceKey ? sequences.find((s) => s.key === c.sequenceKey) : null;
    const { error } = await admin.from('campaigns').insert({
      id, org_id: orgId, name: c.name,
      sequence_id: c.sequenceKey ? sequenceId.get(c.sequenceKey) : null,
      sequence: seq ? seq.name : null,
    });
    if (error) die(`insert campaign ${c.key}: ${error.message}`);
  }

  // contacts (offset -> follow_up date)
  const contactId = new Map();
  for (const c of contacts) {
    const id = randomUUID();
    contactId.set(c.key, id);
    const { error } = await admin.from('contacts').insert({
      id, org_id: orgId, campaign_id: campaignId.get(c.campaignKey),
      first_name: c.firstName, last_name: c.lastName, email: c.email, company: c.company,
      phone: c.phone, mobile: c.mobile, job_title: c.jobTitle, seniority: c.seniority,
      country: c.country, linkedin: c.linkedin, status: c.status, sequence_day: c.sequenceDay,
      follow_up: c.followUpOffsetDays === null ? null : isoDate(addDays(now, c.followUpOffsetDays)),
      notes: c.notes,
    });
    if (error) die(`insert contact ${c.key}: ${error.message}`);
  }

  // touchpoints (daysAgo -> occurred_at)
  for (const tp of touchpoints) {
    const { error } = await admin.from('touchpoints').insert({
      id: randomUUID(), org_id: orgId, contact_id: contactId.get(tp.contactKey),
      channel: tp.channel, note: tp.note, occurred_at: isoAt(addDays(now, -tp.daysAgo)),
      legacy_id: tp.key,
    });
    if (error) die(`insert touchpoint ${tp.key}: ${error.message}`);
  }

  // email_events (recipient normalised on 'sent'; daysAgo -> occurred_at)
  for (const ev of emailEvents) {
    const contact = contacts.find((c) => c.key === ev.contactKey);
    const { error } = await admin.from('email_events').insert({
      id: randomUUID(), org_id: orgId, contact_id: contactId.get(ev.contactKey),
      campaign_id: campaignId.get(ev.campaignKey), type: ev.type, provider: PROVIDER,
      recipient: ev.type === 'sent' ? contact.email.trim().toLowerCase() : null,
      message_id: ev.messageId, subject: ev.subject, sequence_day: ev.sequenceDay,
      occurred_at: isoAt(addDays(now, -ev.daysAgo)),
    });
    if (error) die(`insert email_event ${ev.messageId}: ${error.message}`);
  }

  // suppressions
  for (const s of suppressions) {
    const { error } = await admin.from('suppressions').insert({
      id: randomUUID(), org_id: orgId, email: s.email.trim().toLowerCase(),
      reason: s.reason, contact_id: contactId.get(s.contactKey),
    });
    if (error) die(`insert suppression ${s.email}: ${error.message}`);
  }

  // user_settings
  {
    const { error } = await admin.from('user_settings').insert({
      user_id: userId, org_id: orgId, settings: userSettings,
    });
    if (error) die(`insert user_settings: ${error.message}`);
  }
}

async function main() {
  const summary = validateDataset();
  console.log('seed-dev: dataset validated', summary);
  const { userId, orgId } = await ensureDevOrg();
  console.log(`seed-dev: dev org ${orgId} (user ${userId})`);
  await wipe(orgId, userId);
  console.log('seed-dev: wiped prior dev + E2E rows');
  await insertAll(orgId, userId);
  console.log('seed-dev: inserted dataset ✓');
  console.log('Next: open the app (make dev), or run `make seed-inbox` for live Mailpit replies.');
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
```

- [ ] **Step 2: Smoke-run against the local stack**

Run (requires `make dev` stack up):
```bash
set -a; . ./.env.local; set +a
node scripts/seed-dev.mjs
```
Expected: prints `dataset validated {...}`, a dev org uuid, `wiped …`, `inserted dataset ✓`. No error exit.

- [ ] **Step 3: Verify row counts in the DB**

Run:
```bash
docker exec supabase_db_outreach-hub psql -U postgres -d postgres -tAc \
  "select (select count(*) from campaigns), (select count(*) from contacts), (select count(*) from email_events), (select count(*) from suppressions);"
```
Expected: campaigns 4 (for the dev org; plus any other orgs), contacts ≥18, email_events ≥14, suppressions ≥6. Confirm **no** `E2E %` campaigns remain:
```bash
docker exec supabase_db_outreach-hub psql -U postgres -d postgres -tAc \
  "select count(*) from campaigns where name like 'E2E %';"
```
Expected: `0`.

- [ ] **Step 4: Re-run to confirm idempotency**

Run `node scripts/seed-dev.mjs` again. Expected: same success, counts unchanged (wipe-then-insert).

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-dev.mjs
git commit -m "feat(seed): localhost-guarded dev DB seeder + E2E cleanup"
```

---

## Task 4: Mailpit reply injector

**Files:**
- Create: `scripts/seed-inbox.mjs`

- [ ] **Step 1: Create `scripts/seed-inbox.mjs`**

```js
#!/usr/bin/env node
// scripts/seed-inbox.mjs
//
// Best-effort LOCAL injector of live inbound REPLIES into Mailpit (SMTP :1025),
// so that under EMAIL_DRIVER=mailpit, "Scan inbox now" finds them. The scanner
// classifies each as a reply (non-system sender, non-NDR subject) and correlates
// it to the contact's seeded `sent` event by sender address.
//
// Bounces are NOT injected here: the Mailpit driver can't recover an NDR's failed
// recipient, so the scanner ignores Mailpit bounces. Test bounces via the in-app
// "Sim bounce" button (mock driver), which sets failedRecipient correctly.
//
// If Mailpit isn't reachable, this warns and exits 0 (so `make seed` is fine on
// the default mock stack).

import nodemailer from 'nodemailer';
import { contacts, mailpitReplies } from './seed/dataset.mjs';

const HOST = process.env.MAILPIT_HOST ?? '127.0.0.1';
const PORT = Number(process.env.MAILPIT_SMTP_PORT ?? 1025);
const SENDER = process.env.SEED_SENDER ?? 'paul@displaynote.dev'; // the "you" mailbox

async function main() {
  const transport = nodemailer.createTransport({ host: HOST, port: PORT, secure: false, ignoreTLS: true });
  try {
    await transport.verify();
  } catch (e) {
    console.warn(`seed-inbox: Mailpit not reachable at ${HOST}:${PORT} — skipping (${e instanceof Error ? e.message : e}).`);
    console.warn('seed-inbox: start the dev stack (make dev) and set EMAIL_DRIVER=mailpit to use this path.');
    process.exit(0);
  }

  let sent = 0;
  for (const r of mailpitReplies) {
    const contact = contacts.find((c) => c.key === r.contactKey);
    if (!contact) {
      console.warn(`seed-inbox: no contact for key ${r.contactKey}, skipping`);
      continue;
    }
    await transport.sendMail({
      from: `${contact.firstName} ${contact.lastName} <${contact.email}>`,
      to: SENDER,
      subject: r.subject,
      text: r.body,
    });
    sent += 1;
    console.log(`seed-inbox: queued reply from ${contact.email} ("${r.subject}")`);
  }
  console.log(`seed-inbox: injected ${sent} reply message(s) into Mailpit.`);
  console.log('Next: set EMAIL_DRIVER=mailpit, open the Email Queue, click "Scan inbox now".');
}

main().catch((e) => {
  console.error(`seed-inbox: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
```

- [ ] **Step 2: Smoke-run (Mailpit-up and Mailpit-down)**

With the dev stack up:
```bash
node scripts/seed-inbox.mjs
```
Expected: `queued reply from mike.galkin@example.com …`, `injected 2 reply message(s)`. Confirm in Mailpit UI (http://localhost:8025) that 2 messages arrived.

With Mailpit down (stop the container), re-run: expected a warning + clean `exit 0` (no throw).

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-inbox.mjs
git commit -m "feat(seed): Mailpit reply injector for live inbox testing"
```

---

## Task 5: Makefile targets

**Files:**
- Modify: `Makefile` (add `seed`, `seed-inbox`; update `.PHONY`)

- [ ] **Step 1: Add the two targets**

Append after the existing `db-reset` target block:

```make
seed:  ## Seed LOCAL dev DB with a full-coverage dataset (+ best-effort Mailpit replies)
	@set -a; . ./.env.local; set +a; \
	node scripts/seed-dev.mjs && node scripts/seed-inbox.mjs

seed-inbox:  ## Inject live reply messages into Mailpit (EMAIL_DRIVER=mailpit path)
	@set -a; . ./.env.local; set +a; \
	node scripts/seed-inbox.mjs
```

- [ ] **Step 2: Add both to `.PHONY`**

Modify the `.PHONY` line (currently ends `… db-reset db-migration db-diff fns-serve tunnel clean`) to also list `seed seed-inbox`:

```make
.PHONY: help bootstrap bootstrap-prod dev dev-docker dev-stop test test-e2e lint typecheck build \
        db-reset db-migration db-diff fns-serve tunnel clean seed seed-inbox
```

- [ ] **Step 3: Verify the targets are listed and runnable**

Run: `make help | grep -E 'seed'`
Expected: both `seed` and `seed-inbox` appear with their descriptions.
Run (stack up): `make seed`
Expected: dataset validated → inserted ✓ → Mailpit injection (or skip warning if Mailpit down).

- [ ] **Step 4: Commit**

```bash
git add Makefile
git commit -m "feat(seed): make seed / make seed-inbox targets"
```

---

## Task 6: E2E specs self-clean

**Files:**
- Modify: `tests/e2e/amd-run.spec.ts` (add `test.afterAll`)
- Modify: `tests/e2e/dialler-autodial.spec.ts` (add/extend `test.afterAll`)

> Context: `amd-run.spec.ts` creates a campaign `'E2E AMD Campaign'` in `beforeAll` and never deletes it. `dialler-autodial.spec.ts` creates `'E2E AutoDial Campaign'` and only restores `user_settings` in `afterAll`. Both leak campaigns into the dev DB. The executor MUST first read each spec's `beforeAll` to confirm the exact variable names in scope (`admin`, `orgId`, `CAN_RUN`, `userId`, `E2E_MARKER`) before writing the teardown, and reuse those — do not invent new ones.

- [ ] **Step 1: Add cleanup to `tests/e2e/amd-run.spec.ts`**

Add (or extend) a teardown after the existing `test.beforeAll`. Use the same `admin`/`orgId`/`CAN_RUN` already established in this file:

```ts
test.afterAll(async () => {
  if (!CAN_RUN || !orgId) return;
  // Contacts cascade-delete their touchpoints/email_events; delete them by the
  // campaign, then the campaign itself. Mirrors email-runner.spec.ts's idempotent
  // deletes so repeated runs don't leave 'E2E AMD Campaign' rows in a dev DB.
  const { data: camps } = await admin
    .from('campaigns')
    .select('id')
    .eq('org_id', orgId)
    .eq('name', 'E2E AMD Campaign');
  for (const c of camps ?? []) {
    await admin.from('contacts').delete().eq('org_id', orgId).eq('campaign_id', (c as { id: string }).id);
  }
  await admin.from('campaigns').delete().eq('org_id', orgId).eq('name', 'E2E AMD Campaign');
});
```

- [ ] **Step 2: Add/extend cleanup in `tests/e2e/dialler-autodial.spec.ts`**

This file already has a `test.afterAll` that restores `user_settings`. Add the campaign cleanup INSIDE that existing block (after the settings restore), reusing its `admin`/`orgId`/`userId`/`CAN_RUN`:

```ts
  // Remove the campaign this spec created so it doesn't accumulate in a dev DB.
  const { data: dialCamps } = await admin
    .from('campaigns')
    .select('id')
    .eq('org_id', orgId)
    .eq('name', 'E2E AutoDial Campaign');
  for (const c of dialCamps ?? []) {
    await admin.from('contacts').delete().eq('org_id', orgId).eq('campaign_id', (c as { id: string }).id);
  }
  await admin.from('campaigns').delete().eq('org_id', orgId).eq('name', 'E2E AutoDial Campaign');
```

- [ ] **Step 3: Type-check the specs**

Run: `make typecheck`
Expected: no errors (the `(c as { id: string })` casts satisfy strict mode).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/amd-run.spec.ts tests/e2e/dialler-autodial.spec.ts
git commit -m "test(e2e): self-clean campaigns in amd-run and dialler-autodial"
```

---

## Task 7: Docs

**Files:**
- Modify: `docs/development.md` (add a "Seeding dev data" section)

- [ ] **Step 1: Add the section**

Append to `docs/development.md`:

```markdown
## Seeding dev data

`make seed` fills your LOCAL Supabase with a realistic, full-coverage dataset so
every screen has something to work with, and removes the `E2E *` rows that e2e
runs leave behind. It is **localhost-only** (it refuses to run unless
`NEXT_PUBLIC_SUPABASE_URL` points at `127.0.0.1`/`localhost`) and **idempotent**
(wipe-then-insert scoped to the dev org), so you can re-run it any time.

Prereqs: the dev stack is up (`make dev`) and you have signed in once via
`/auth/mock` (so the dev org exists). Then:

```bash
make seed         # dataset + best-effort Mailpit reply injection
make seed-inbox   # just re-inject the Mailpit replies
```

What it creates: a template library, three sequences (one multi-step), four
campaigns (one deliberately **unlinked**, to show the queue's "Not linked"
state), ~20 contacts spanning every status / sequence position / follow-up
bucket (incl. due-today and overdue), touchpoints, send/reply/bounce history,
suppressions, and tuned per-user goals/dialler settings.

### Testing the inbox

- **Replies (live):** run with `EMAIL_DRIVER=mailpit`, then `make seed-inbox`
  injects reply messages into Mailpit (http://localhost:8025). Open the Email
  Queue and click **Scan inbox now** — the scanner correlates each reply to the
  contact by sender address and records it.
- **Bounces (live):** use the in-app **Sim bounce** button on the Email Queue
  (default `mock` driver). The Mailpit path can't carry a recoverable failed
  recipient, so bounces are exercised through the mock driver instead.
- **History (always):** `make seed` also writes past `sent`/`reply`/`bounce`
  `email_events` so Activity, Reports and the pipeline look populated without any
  scanning.
```

- [ ] **Step 2: Commit**

```bash
git add docs/development.md
git commit -m "docs(seed): document make seed and the inbox-testing paths"
```

---

## Task 8: Final verification

- [ ] **Step 1: Full check suite**

Run:
```bash
make typecheck && make lint && make test
```
Expected: typecheck clean; lint 0 errors (the 2 pre-existing config warnings are fine); all unit tests pass (including `tests/unit/seed/dataset.test.ts`).

- [ ] **Step 2: Browser smoke (preview)**

With the stack up and `make seed` run, start the preview (`.claude/launch.json` → `dev-verify`, port 3100), sign in via `POST /auth/mock`, and load: `/today`, `/pipeline`, `/queue`, `/contacts`, `/campaigns`, `/sequences`, `/templates`, `/suppressions`, `/reports`, `/dialler`, `/settings`. Confirm each shows seeded data (e.g. Queue has due-today contacts; Campaigns shows 3 linked + 1 "—"; Settings shows the goals). Check console: no errors.

- [ ] **Step 3: Mailpit reply round-trip (optional, EMAIL_DRIVER=mailpit)**

Set `EMAIL_DRIVER=mailpit` in `.env.local`, `make seed-inbox`, open `/queue`, click **Scan inbox now**. Expected banner: `2 replies, 0 bounces` (or similar) and the two contacts (`mike`, `sara`) flip to replied/suppressed.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin chore/dev-seed-dataset
gh pr create --base main --title "chore(seed): full-coverage dev dataset + E2E cleanup" --body "<summary of the spec + what each script does + how to run>"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** dataset module (Task 2), seeder w/ localhost guard + ensure-org + wipe incl. E2E + insert (Task 3), Mailpit injector (Task 4), Makefile (Task 5), E2E self-clean (Task 6), docs (Task 7), unit test (Task 2), verification incl. browser + mailpit (Task 8). All spec sections map to a task.
- **Placeholders:** none — every code step contains full code; the only "<…>" is the PR body free-text in the final command.
- **Type/name consistency:** dataset exports (`templates/sequences/campaigns/contacts/touchpoints/emailEvents/suppressions/userSettings/mailpitReplies/validateDataset/ENUMS`) are used identically in the test, seeder, and injector. Key fields (`contactKey`, `campaignKey`, `templateKey`, `sequenceKey`, `followUpOffsetDays`, `daysAgo`, `messageId`) are consistent across producer and consumers. `addDays/isoDate/isoAt` signatures match their uses.
- **Adjustment vs spec:** spec said "~40 contacts"; the plan delivers ~20 curated contacts that cover every status and follow-up bucket (coverage over raw volume). More can be appended to the `contacts` array later without touching the seeder.
```
