# Phase 5 follow-up — per-rep multi-mailbox outreach

**Status:** Deferred follow-up (not yet built). Spun out of
[PHASE_5_SPEC.md](PHASE_5_SPEC.md) §0.

**Not Phase 6.** Phase 6 in the execution plan is **Compliance + audit** (CTPS /
GDPR right-to-be-forgotten / hash-chained audit). This per-rep email work is a
**distinct follow-up** with its own scope and is unrelated to the compliance
phase — do not fold it into Phase 6.

## Why this doc exists

Phase 5 ships an email runner where each rep can scan **their own mailbox**
(the manual "Scan inbox now" binds the Graph driver to the signed-in user's
delegated token), while the cron scans **one configured org mailbox**
(`CRON_ORG_ID` / `settings.senderEmail` / `CRON_SENDER_EMAIL`).

The inbox-scan high-water cursor was originally stored **once per org**
(`organizations.settings.lastInboxScanAt` / `lastInboxScanIds`). With two
different mailboxes scanning, the first mailbox to scan advanced the shared org
cursor past messages in the other mailbox, so replies/bounces in the second
mailbox were skipped **permanently**.

**Fixed in Phase 5:** the cursor is now keyed **per mailbox** —
`organizations.settings.inboxScanCursors = { "<mailbox>": { at, ids }, … }`,
advanced via the atomic, mailbox-scoped `public.advance_inbox_scan_cursor(p_org_id,
p_mailbox, p_at, p_ids)` RPC (a nested `jsonb_set` that touches only that
mailbox's sub-key). Mailbox A's scan can no longer advance/skip mailbox B's
position.

That per-mailbox cursor is the **data-model prerequisite** that makes the work
below safe: cursors are already keyed by mailbox, so adding more mailboxes
(true per-rep) cannot retroactively skip mail.

## Remaining work (deferred — do NOT build now)

1. **Contact / campaign ownership (`user_id`).**
   Add a `user_id` (owning rep) to `contacts` and `campaigns` so the runner and
   scanner can be scoped to a rep's own book of business rather than the whole
   org. Requires RLS changes and a backfill strategy for existing rows.

2. **Per-mailbox daily send cap.**
   Today `dailyGoal` is an org-wide cap enforced against `last_emailed_at`. With
   multiple reps sending from distinct mailboxes, the cap must be evaluated
   per mailbox (per rep) so one rep's volume doesn't starve another, and so each
   mailbox stays under its provider's sending limits.

3. **Per-user Graph token storage + refresh.**
   The manual path binds to the signed-in user's `session.provider_token`, which
   Supabase does not auto-refresh. Persisting and refreshing each rep's delegated
   Graph token (e.g. Vault + the refresh token) lets background/cron work act on
   behalf of each rep's mailbox after their session's provider token expires.
   This is the same deferral noted in PHASE_5_SPEC §0.

4. **Per-user cron iteration.**
   The cron currently scans a single configured org mailbox (`CRON_ORG_ID`). True
   multi-mailbox cron needs to iterate per rep, constructing a per-user Graph
   driver/token for each, then scan each rep's mailbox into its own per-mailbox
   cursor. Depends on (3) for the stored tokens and on (1) to know which contacts
   each mailbox is responsible for.

## Sequencing

(1) ownership is the natural first step (it scopes everything else); (3) token
storage unblocks (4) per-user cron; (2) the per-mailbox cap can land alongside
(1) once each send is attributable to a rep/mailbox. None of these change the
per-mailbox cursor shape already landed in Phase 5.
