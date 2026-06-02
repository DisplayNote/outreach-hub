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
  // Loopback only — IPv4, the `localhost` alias, and IPv6 `::1` (URL.hostname
  // returns it bracketed as `[::1]`). Anything else is treated as remote.
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]' && host !== '::1') {
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
  {
    const { error } = await admin.from('user_settings').delete().eq('user_id', userId);
    if (error) die(`wipe user_settings failed: ${error.message}`);
  }

  // Belt-and-braces: clear E2E-named rows globally in case e2e used another org.
  // Fail loudly on error — a silent failure here would leave the very clutter
  // this step claims to remove while still reporting success.
  for (const [table, column] of [
    ['contacts', 'company'],
    ['campaigns', 'name'],
    ['sequences', 'name'],
    ['templates', 'name'],
  ]) {
    const { error } = await admin.from(table).delete().like(column, 'E2E %');
    if (error) die(`wipe E2E ${table} failed: ${error.message}`);
  }
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
