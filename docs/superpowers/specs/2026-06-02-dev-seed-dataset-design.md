# Dev seed dataset + E2E cleanup — design

**Date:** 2026-06-02
**Status:** Approved (design)
**Author:** Claude Code session

## Problem

Running the app in dev mode (`make dev`) lands you in a nearly empty database:
the only meaningful rows are whatever the mock-auth flow created plus a **pile of
`E2E AMD Campaign`** rows left behind by e2e runs. There is no realistic data to
exercise the product — no multi-step sequences, no contacts at varied pipeline
positions, no email send/reply/bounce history, no suppressions, no dialler-ready
phone numbers, no tuned goals. The result: most screens (Today, Pipeline, Queue,
Reports, Activity, Dialler, Settings) look dead and can't be tested properly.

Two underlying facts constrain the solution:

1. **The dev org/user is created lazily on first sign-in.** `/auth/mock` seeds
   `dev@outreach.local` + "Dev Org" via the `on_auth_user_created` trigger, so
   `supabase/seed.sql` (which runs during `db reset`, before sign-in) cannot
   attach data to that org. The e2e suite works around this by using the
   service-role admin client to resolve the dev org *after* it exists.
2. **The dev "inbox" is in-memory and ephemeral.** With the default `mock`
   driver, inbound messages live in a process-global queue inside the running
   `next dev` process (`lib/email/dev-inbox.ts`), populated only by the in-app
   "Sim reply / Sim bounce" buttons. An external script cannot push into it, and
   it does not survive a restart. What *is* persistently seedable is the
   `email_events` history (and, for live unscanned mail, Mailpit under
   `EMAIL_DRIVER=mailpit`).

## Goals

- One command (`make seed`) populates a realistic, full-coverage dev dataset.
- Idempotent and re-runnable; never touches a non-local database.
- Removes the existing `E2E *` clutter and stops it recurring.
- Exercises the email/inbox flow both as persisted history and as live
  (Mailpit) inbound.

## Non-goals

- Seeding production or any remote environment.
- Seeding the mock driver's in-memory inbox (impossible from another process;
  covered by the in-app Sim buttons instead).
- Changing the runtime app behaviour or schema.

## Components

### 1. `scripts/seed/dataset.mjs` — pure dataset definition (no DB)
Exports the in-memory object graph and a `validateDataset()` guard. No Supabase
imports, no side effects — pure data + validation so it is unit-testable and
keeps `lib/` free of dev-only fixtures.

- Graph: `templates → sequences (+steps) → campaigns → contacts → touchpoints →
  emailEvents → suppressions → userSettings`.
- Cross-references use **local string keys** (e.g. `templateKey`, `sequenceKey`,
  `campaignKey`, `contactKey`); the seeder resolves them to real UUIDs at insert
  time. This keeps the definition readable and lets `validateDataset()` check
  referential integrity without a database.
- `validateDataset()` asserts:
  - every email `sequence_step` references a template key that exists;
  - every campaign's `sequenceKey` (when set) exists;
  - every contact's `campaignKey` exists;
  - every touchpoint / emailEvent / suppression references an existing contact;
  - all `status` values ∈ `contact_status`, all `channel` values ∈
    `touchpoint_channel`, all `email_events.type` ∈ {sent,reply,bounce}, all
    `suppressions.reason` ∈ {replied,bounced,manual,unsubscribed};
  - every `email_events.reply`/`bounce` row has a corresponding `sent` row and a
    suppression where the model implies one.

### 2. `scripts/seed-dev.mjs` — DB seeder
Mirrors `scripts/import-legacy.mjs` conventions (ESM, `@supabase/supabase-js`
service-role client, env from `NEXT_PUBLIC_SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY`).

Steps:
1. **Localhost guard** — parse `NEXT_PUBLIC_SUPABASE_URL`; abort unless host is
   `127.0.0.1` or `localhost`. Prevents ever seeding a remote/prod project.
2. **Ensure dev user/org** — `admin.auth.admin.createUser` for
   `dev@outreach.local` (ignore "already exists"), then read `org_id` from
   `public.users`.
3. **Clean slate** (idempotent):
   - Delete all rows for the dev org across `suppressions`, `email_events`,
     `touchpoints`, `contacts`, `sequence_steps`, `sequences`, `templates`,
     `campaigns` (respecting FK/cascade order), and reset `user_settings` for the
     dev user.
   - Globally delete e2e-named rows: `campaigns.name LIKE 'E2E %'`,
     `contacts.company LIKE 'E2E %'`, sequences/templates named with the e2e
     markers, and the e2e suppression addresses. (Belt-and-braces in case e2e
     used a different org.)
4. **Insert** the validated dataset (resolve keys → UUIDs as we go), in FK order.
5. **Summary** — print per-table inserted counts and next-step hints.

### 3. `scripts/seed-inbox.mjs` — Mailpit injector
Uses `nodemailer` (already a dependency) to SMTP-deliver fake inbound messages to
Mailpit at `localhost:1025` (accepts any auth):
- A few **replies** from seeded contacts (`From:` the contact, `Subject: Re: …`,
  `In-Reply-To`/`References` pointing at the seeded `sent` message-ids so the
  scanner's correlation succeeds).
- A couple of **bounce** NDRs (`From: mailer-daemon@…`, body naming the failed
  recipient).

These appear via "Scan inbox now" when `EMAIL_DRIVER=mailpit`. **Best-effort**:
if `:1025` is unreachable, log a warning and exit 0 (so `make seed` doesn't fail
when the user runs the default mock stack).

### 4. E2E self-clean
Add `test.afterAll` teardown to `tests/e2e/amd-run.spec.ts` and
`tests/e2e/dialler-autodial.spec.ts` that deletes the campaigns (and any other
rows they create) by `org_id` + name/marker — mirroring the idempotent delete
block `email-runner.spec.ts` already runs in `beforeAll`. Stops the clutter
recurring.

### 5. Makefile + docs
- `make seed` — load `.env.local` (via `scripts/lib/load-dotenv.sh`), run
  `node scripts/seed-dev.mjs`, then best-effort `node scripts/seed-inbox.mjs`.
- `make seed-inbox` — run only the Mailpit injector.
- Add both to `.PHONY` and the `help` target.
- `docs/development.md` — a short "Seeding dev data" section: what `make seed`
  creates, the localhost guard, idempotency, and the two inbox-testing paths
  (default `mock` + Sim buttons, or `EMAIL_DRIVER=mailpit` + `make seed-inbox` +
  Scan).

## The dataset (full coverage)

- **~6 templates**: intro, follow-up #1, follow-up #2, break-up, re-engagement,
  meeting-confirm — with `{{firstName}}` / `{{company}}` placeholders.
- **3 sequences (+ steps)**:
  - *MSP Cold Outreach* — 5 steps, email/linkedin mix at day offsets 0/3/5/7/14.
  - *Re-engagement* — 3 steps.
  - *Event Follow-up* — 2 steps.
- **4 campaigns**: 3 linked to sequences via `sequence_id` (+ denormalised name);
  **1 deliberately unlinked** to exercise the "Not linked — set it" queue state.
- **~40 contacts** across campaigns spanning **every** `contact_status`
  (none/amber/red/green/meeting/notinterested/bounced), varied `sequence_day` and
  `follow_up` (due-today / overdue / future / null), phone+mobile on a good
  subset (dialler-ready), realistic names/companies/titles/countries/LinkedIn.
- **Touchpoints**: a few per active contact (email/phone/linkedin) spread over
  recent weeks → rich Activity feed and contact timelines.
- **email_events**: `sent` rows matching sequence progression; `reply` rows for
  green/meeting contacts; `bounce` rows for bounced contacts.
- **suppressions**: examples of each reason (replied / bounced / manual /
  unsubscribed).
- **user_settings** (dev user): daily/weekly goals, rhythm thresholds, signature,
  note snippets, Telnyx dialler identity + dialler prefs.

## Safety, idempotency, testing

- Service-role bypasses RLS (required for cross-table dev seeding); the
  **localhost guard** is the hard stop against prod writes.
- **Wipe-then-insert scoped to the dev org** makes each run deterministic; the
  dev org is a throwaway, so a full wipe is safe.
- **Unit test** (`tests/unit/seed/dataset.test.ts`): imports `dataset.mjs`,
  runs `validateDataset()`, and asserts the coverage invariants (all statuses
  present, ≥1 due-today contact, ≥1 unlinked campaign, every email step has a
  template). A future edit that breaks the graph fails CI rather than the seed
  run.
- **Manual verification**: run `make seed` against the local stack and load
  Today / Pipeline / Queue / Reports / Dialler / Settings in the preview to
  confirm each populates; with `EMAIL_DRIVER=mailpit`, run `make seed-inbox` and
  "Scan inbox now" to confirm a reply and a bounce are processed.

## Files touched

- `scripts/seed/dataset.mjs` (new)
- `scripts/seed-dev.mjs` (new)
- `scripts/seed-inbox.mjs` (new)
- `tests/unit/seed/dataset.test.ts` (new)
- `tests/e2e/amd-run.spec.ts` (afterAll cleanup)
- `tests/e2e/dialler-autodial.spec.ts` (afterAll cleanup)
- `Makefile` (seed, seed-inbox targets)
- `docs/development.md` (seeding section)
