#!/usr/bin/env node
// scripts/import-legacy.mjs
//
// Legacy data importer for Outreach Hub Phase 1.
//
// Reads a legacy "APP" export JSON (the blob the legacy single-file PWA
// `legacy/PaulsOutreachHub.html` keeps in IndexedDB under the `outreach_hub_v6`
// key) and inserts it into Supabase. It maps the legacy domain model
// (campaigns -> contacts -> touchpoints) onto the Phase 1 schema created in
// supabase/migrations/20260529120000_phase1_domain.sql.
//
// IMPORTANT — getting REAL data:
//   The legacy app stores everything in the browser's IndexedDB, NOT on disk.
//   To import Paul's real pipeline you first need him to EXPORT the APP blob to
//   a .json file (the in-app "Backup / Export" affordance writes the
//   `{ campaigns, activeCampId, sentEmailIds, meta }` object). Hand that .json
//   to this script via --file. The fixture in scripts/fixtures/legacy-sample.json
//   shows the exact shape and is what the smoke test uses.
//
// This script runs with the Supabase SERVICE ROLE key, so it bypasses RLS. It
// is idempotent: re-running with the same export upserts on (org_id, legacy_id)
// and will not create duplicate rows.
//
// Usage:
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/import-legacy.mjs --file <path.json> --org-id <uuid>
//
// Example (against the local stack + the bundled fixture):
//   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
//   SUPABASE_SERVICE_ROLE_KEY=<local service role key> \
//     node scripts/import-legacy.mjs \
//       --file scripts/fixtures/legacy-sample.json \
//       --org-id 00000000-0000-0000-0000-000000000001

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

// --- Enum maps (legacy value -> Phase 1 enum member) --------------------------

const CONTACT_STATUSES = new Set([
  'none',
  'amber',
  'red',
  'green',
  'meeting',
  'notinterested',
  'bounced',
]);

// Legacy stores title-case channels; the enum is lower-case.
const CHANNEL_MAP = {
  email: 'email',
  phone: 'phone',
  linkedin: 'linkedin',
  other: 'other',
};

// --- Argument parsing ---------------------------------------------------------

function parseArgs(argv) {
  /** @type {{ file?: string; orgId?: string }} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--file') {
      out.file = argv[i + 1];
      i += 1;
    } else if (arg === '--org-id') {
      out.orgId = argv[i + 1];
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      out.help = true;
    }
  }
  return out;
}

const USAGE = `Usage: node scripts/import-legacy.mjs --file <path.json> --org-id <uuid>

Environment:
  NEXT_PUBLIC_SUPABASE_URL      Supabase project / local stack URL
  SUPABASE_SERVICE_ROLE_KEY     Service role key (bypasses RLS)`;

function fail(message) {
  console.error(`import-legacy: ${message}`);
  process.exit(1);
}

// --- Field mapping helpers ----------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Extract a stable integer legacy id from either a number or a "camp_<n>" string. */
function toLegacyInt(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const digits = value.match(/\d+/g);
    if (digits && digits.length > 0) {
      const n = Number.parseInt(digits.join(''), 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/** Normalise a legacy ISO date string to an ISO timestamp, or null. */
function toIsoTimestamp(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return null;
  return new Date(ts).toISOString();
}

/** Normalise a legacy ISO date string to a YYYY-MM-DD date string, or null. */
function toDateOnly(value) {
  const iso = toIsoTimestamp(value);
  if (iso === null) return null;
  return iso.slice(0, 10);
}

function mapStatus(value) {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return CONTACT_STATUSES.has(v) ? v : 'none';
}

function mapChannel(value) {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return CHANNEL_MAP[v] ?? 'other';
}

function nullableText(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function nullableInt(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number.parseInt(value, 10);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// --- Main ---------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(USAGE);
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) fail('NEXT_PUBLIC_SUPABASE_URL is not set.');
  if (!serviceRoleKey) fail('SUPABASE_SERVICE_ROLE_KEY is not set.');
  if (!args.file) fail(`--file <path.json> is required.\n\n${USAGE}`);
  if (!args.orgId) fail(`--org-id <uuid> is required.\n\n${USAGE}`);
  if (!UUID_RE.test(args.orgId)) fail(`--org-id must be a UUID, got: ${args.orgId}`);

  const orgId = args.orgId;

  // Read and parse the legacy APP blob.
  const filePath = resolve(process.cwd(), args.file);
  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (err) {
    fail(`could not read --file ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  let app;
  try {
    app = JSON.parse(raw);
  } catch (err) {
    fail(`--file is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  const campaigns = Array.isArray(app?.campaigns) ? app.campaigns : null;
  if (!campaigns) {
    fail('export has no top-level `campaigns` array — is this the APP blob shape?');
    return;
  }

  // Service role client. No session persistence — this is a one-shot CLI.
  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const summary = { campaigns: 0, contacts: 0, touchpoints: 0 };

  for (const legacyCampaign of campaigns) {
    const campaignLegacyId = toLegacyInt(legacyCampaign?.id);
    if (campaignLegacyId === null) {
      console.warn(
        `skipping campaign with unparseable id ${JSON.stringify(legacyCampaign?.id)} (name: ${legacyCampaign?.name ?? '?'})`,
      );
      continue;
    }

    const campaignRow = {
      org_id: orgId,
      name: nullableText(legacyCampaign?.name) ?? 'Untitled campaign',
      sequence: nullableText(legacyCampaign?.sequence),
      legacy_id: campaignLegacyId,
    };

    const { data: campaignData, error: campaignError } = await supabase
      .from('campaigns')
      .upsert(campaignRow, { onConflict: 'org_id,legacy_id' })
      .select('id')
      .single();

    if (campaignError || !campaignData) {
      fail(
        `failed to upsert campaign legacy_id=${campaignLegacyId}: ${campaignError?.message ?? 'no row returned'}`,
      );
      return;
    }
    summary.campaigns += 1;
    const campaignId = campaignData.id;

    const legacyContacts = Array.isArray(legacyCampaign?.contacts) ? legacyCampaign.contacts : [];

    for (const legacyContact of legacyContacts) {
      const contactLegacyId = toLegacyInt(legacyContact?.id);
      if (contactLegacyId === null) {
        console.warn(
          `skipping contact with unparseable id ${JSON.stringify(legacyContact?.id)} in campaign legacy_id=${campaignLegacyId}`,
        );
        continue;
      }

      const contactRow = {
        org_id: orgId,
        campaign_id: campaignId,
        first_name: nullableText(legacyContact?.firstName),
        last_name: nullableText(legacyContact?.lastName),
        email: nullableText(legacyContact?.email),
        company: nullableText(legacyContact?.company),
        phone: nullableText(legacyContact?.phone),
        mobile: nullableText(legacyContact?.mobile),
        job_title: nullableText(legacyContact?.jobTitle),
        seniority: nullableText(legacyContact?.seniority),
        country: nullableText(legacyContact?.country),
        linkedin: nullableText(legacyContact?.linkedin),
        status: mapStatus(legacyContact?.status),
        sequence_day: nullableInt(legacyContact?.sequenceDay),
        follow_up: toDateOnly(legacyContact?.followUp),
        notes: nullableText(legacyContact?.notes),
        legacy_id: contactLegacyId,
      };

      const { data: contactData, error: contactError } = await supabase
        .from('contacts')
        .upsert(contactRow, { onConflict: 'org_id,legacy_id' })
        .select('id')
        .single();

      if (contactError || !contactData) {
        fail(
          `failed to upsert contact legacy_id=${contactLegacyId}: ${contactError?.message ?? 'no row returned'}`,
        );
        return;
      }
      summary.contacts += 1;
      const contactId = contactData.id;

      const legacyTouchpoints = Array.isArray(legacyContact?.touchpoints)
        ? legacyContact.touchpoints
        : [];

      const touchpointRows = [];
      for (const tp of legacyTouchpoints) {
        const tpLegacyId = nullableText(tp?.id);
        if (tpLegacyId === null) {
          console.warn(
            `skipping touchpoint with missing id on contact legacy_id=${contactLegacyId}`,
          );
          continue;
        }
        touchpointRows.push({
          org_id: orgId,
          contact_id: contactId,
          channel: mapChannel(tp?.channel),
          note: nullableText(tp?.note),
          occurred_at: toIsoTimestamp(tp?.date) ?? new Date().toISOString(),
          legacy_id: tpLegacyId,
        });
      }

      if (touchpointRows.length > 0) {
        const { error: tpError } = await supabase
          .from('touchpoints')
          .upsert(touchpointRows, { onConflict: 'org_id,legacy_id' });

        if (tpError) {
          fail(
            `failed to upsert ${touchpointRows.length} touchpoint(s) for contact legacy_id=${contactLegacyId}: ${tpError.message}`,
          );
          return;
        }
        summary.touchpoints += touchpointRows.length;
      }
    }
  }

  console.log('import-legacy: done.');
  console.log(`  org_id:      ${orgId}`);
  console.log(`  campaigns:   ${summary.campaigns}`);
  console.log(`  contacts:    ${summary.contacts}`);
  console.log(`  touchpoints: ${summary.touchpoints}`);
}

main().catch((err) => {
  fail(err instanceof Error ? (err.stack ?? err.message) : String(err));
});
