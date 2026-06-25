#!/usr/bin/env node
// scripts/seed-dev.mjs
//
// Re-runnable LOCAL dev seeder. Fills the dev org with a realistic, full-coverage
// dataset (scripts/seed/dataset.mjs) and removes the `E2E *` clutter that e2e
// runs leave behind. Idempotent: wipe-then-insert scoped to the dev org.
//
// Connects as the Postgres superuser (DATABASE_URL_ADMIN), which bypasses RLS —
// the Azure-native equivalent of the retired Supabase service-role key. Hard-
// guarded to a loopback host so it can never touch a remote/prod database.
//
// Usage (via `make seed`, which loads .env.local first):
//   DATABASE_URL_ADMIN=postgres://postgres:postgres@localhost:5433/outreach \
//     node scripts/seed-dev.mjs

import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
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

const DEV_EMAIL = 'dev@outreach.local'; // matches the Auth.js dev Credentials provider
const PROVIDER = 'mock';

const adminUrl = process.env.DATABASE_URL_ADMIN;

function die(msg) {
  console.error(`seed-dev: ${msg}`);
  process.exit(1);
}

// --- Localhost guard (hard stop against seeding a remote database) -----------
if (!adminUrl) die('DATABASE_URL_ADMIN is not set');
{
  let host;
  try {
    host = new URL(adminUrl).hostname;
  } catch {
    die(`could not parse DATABASE_URL_ADMIN: ${adminUrl}`);
  }
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]' && host !== '::1') {
    die(`refusing to run against non-local host "${host}". This script is LOCAL-ONLY.`);
  }
}

const client = new Client({ connectionString: adminUrl, ssl: false });

async function ensureDevOrg() {
  // Provision the dev org + user via the same RPC the app's first-login path
  // uses (idempotent: returns the existing row on re-runs).
  const { rows } = await client.query(
    'select user_id, org_id from public.provision_user($1, $2)',
    [DEV_EMAIL, 'Dev User'],
  );
  const row = rows[0];
  if (!row) die('provision_user returned no row for the dev user');
  return { userId: row.user_id, orgId: row.org_id };
}

async function wipe(orgId, userId) {
  // Child-first within the dev org. Delete campaigns right after contacts and
  // BEFORE sequences/templates: a campaign's sequence_id FK is ON DELETE SET NULL,
  // so removing sequences first would issue needless UPDATEs on rows about to go.
  for (const table of ['suppressions', 'email_events', 'touchpoints', 'contacts', 'campaigns', 'sequence_steps', 'sequences', 'templates']) {
    await client.query(`delete from public.${table} where org_id = $1`, [orgId]);
  }
  await client.query('delete from public.user_settings where user_id = $1', [userId]);

  // Belt-and-braces: clear E2E-named rows globally in case e2e used another org.
  for (const [table, column] of [
    ['contacts', 'company'],
    ['campaigns', 'name'],
    ['sequences', 'name'],
    ['templates', 'name'],
  ]) {
    await client.query(`delete from public.${table} where ${column} like 'E2E %'`);
  }
}

async function insertAll(orgId, userId) {
  const now = new Date();

  // templates
  const templateId = new Map();
  for (const t of templates) {
    const id = randomUUID();
    templateId.set(t.key, id);
    await client.query(
      'insert into public.templates (id, org_id, name, subject, body) values ($1,$2,$3,$4,$5)',
      [id, orgId, t.name, t.subject, t.body],
    );
  }

  // sequences + steps
  const sequenceId = new Map();
  for (const s of sequences) {
    const id = randomUUID();
    sequenceId.set(s.key, id);
    await client.query('insert into public.sequences (id, org_id, name) values ($1,$2,$3)', [id, orgId, s.name]);
    for (const step of s.steps) {
      await client.query(
        'insert into public.sequence_steps (id, org_id, sequence_id, step_order, day_offset, channel, template_id) values ($1,$2,$3,$4,$5,$6,$7)',
        [randomUUID(), orgId, id, step.order, step.dayOffset, step.channel, step.templateKey ? templateId.get(step.templateKey) : null],
      );
    }
  }

  // campaigns (set both sequence_id and the denormalised display name)
  const campaignId = new Map();
  for (const c of campaigns) {
    const id = randomUUID();
    campaignId.set(c.key, id);
    const seq = c.sequenceKey ? sequences.find((s) => s.key === c.sequenceKey) : null;
    await client.query(
      'insert into public.campaigns (id, org_id, name, sequence_id, sequence) values ($1,$2,$3,$4,$5)',
      [id, orgId, c.name, c.sequenceKey ? sequenceId.get(c.sequenceKey) : null, seq ? seq.name : null],
    );
  }

  // contacts (offset -> follow_up date)
  const contactId = new Map();
  for (const c of contacts) {
    const id = randomUUID();
    contactId.set(c.key, id);
    await client.query(
      `insert into public.contacts
        (id, org_id, campaign_id, first_name, last_name, email, company, phone, mobile,
         job_title, seniority, country, linkedin, status, sequence_day, follow_up, notes)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        id, orgId, campaignId.get(c.campaignKey), c.firstName, c.lastName, c.email, c.company,
        c.phone, c.mobile, c.jobTitle, c.seniority, c.country, c.linkedin, c.status, c.sequenceDay,
        c.followUpOffsetDays === null ? null : isoDate(addDays(now, c.followUpOffsetDays)), c.notes,
      ],
    );
  }

  // touchpoints (daysAgo -> occurred_at)
  for (const tp of touchpoints) {
    await client.query(
      'insert into public.touchpoints (id, org_id, contact_id, channel, note, occurred_at, legacy_id) values ($1,$2,$3,$4,$5,$6,$7)',
      [randomUUID(), orgId, contactId.get(tp.contactKey), tp.channel, tp.note, isoAt(addDays(now, -tp.daysAgo)), tp.key],
    );
  }

  // email_events (recipient normalised on 'sent'; daysAgo -> occurred_at)
  for (const ev of emailEvents) {
    const contact = contacts.find((c) => c.key === ev.contactKey);
    await client.query(
      `insert into public.email_events
        (id, org_id, contact_id, campaign_id, type, provider, recipient, message_id, subject, sequence_day, occurred_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        randomUUID(), orgId, contactId.get(ev.contactKey), campaignId.get(ev.campaignKey), ev.type, PROVIDER,
        ev.type === 'sent' ? contact.email.trim().toLowerCase() : null, ev.messageId, ev.subject, ev.sequenceDay,
        isoAt(addDays(now, -ev.daysAgo)),
      ],
    );
  }

  // suppressions
  for (const s of suppressions) {
    await client.query(
      'insert into public.suppressions (id, org_id, email, reason, contact_id) values ($1,$2,$3,$4,$5)',
      [randomUUID(), orgId, s.email.trim().toLowerCase(), s.reason, contactId.get(s.contactKey)],
    );
  }

  // user_settings
  await client.query(
    'insert into public.user_settings (user_id, org_id, settings) values ($1,$2,$3)',
    [userId, orgId, userSettings],
  );
}

async function main() {
  const summary = validateDataset();
  console.log('seed-dev: dataset validated', summary);
  await client.connect();
  try {
    const { userId, orgId } = await ensureDevOrg();
    console.log(`seed-dev: dev org ${orgId} (user ${userId})`);
    await wipe(orgId, userId);
    console.log('seed-dev: wiped prior dev + E2E rows');
    await insertAll(orgId, userId);
    console.log('seed-dev: inserted dataset ✓');
    console.log('Next: open the app (make dev), or run `make seed-inbox` for live Mailpit replies.');
  } finally {
    await client.end();
  }
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
