import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Live AMD-run walk-through (PHASE_4_SPEC §10). Drives the real stack end-to-end
 * with the mock Telnyx backend: dev sign-in → start an AMD run over a seeded
 * machine-suffix contact → the server auto-detects the machine, hangs up, and
 * auto-logs the voicemail touchpoint, all surfaced live over Realtime.
 *
 * Seeds directly via the service-role client (reading .env.local). The human and
 * no-answer branches are covered deterministically by the unit suite
 * (amd-mock-backend.test.ts); this proves the UI + Realtime + Server Actions +
 * persistence are wired correctly against Postgres.
 */

function readEnvLocal(): Record<string, string> {
  try {
    const raw = readFileSync('.env.local', 'utf8');
    const out: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue;
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(trimmed);
      if (!m) continue;
      let value = m[2]!.trim();
      // Strip a single pair of surrounding quotes if present.
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      }
      out[m[1]!] = value;
    }
    return out;
  } catch {
    return {};
  }
}

const env = readEnvLocal();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY ?? '';

/** Only ever run the destructive service-role seeding against a local stack. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
function isLoopback(url: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}
const MACHINE_NUMBER = '+447700900002';
const E2E_MARKER = 'E2E AMD Machine';

// This test deletes/creates rows via the service role, so it runs ONLY against a
// local stack with a service key. Decided at collection time (env is read at
// import) so the destructive beforeAll never runs when the guard fails — a
// runtime test.skip() inside beforeAll wouldn't prevent the seeding side-effects.
const CAN_RUN = SERVICE_KEY !== '' && isLoopback(SUPABASE_URL);
const maybeTest = CAN_RUN ? test : test.skip;

let admin: SupabaseClient;
let contactId: string;

test.beforeAll(async () => {
  if (!CAN_RUN) return; // no service key / non-loopback URL → skip seeding entirely
  admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Ensure the dev user/org exists (mirrors /auth/mock), then resolve its org.
  await admin.auth.admin
    .createUser({
      email: 'dev@outreach.local',
      password: 'dev-password-12345',
      email_confirm: true,
      user_metadata: { full_name: 'Dev User', org_name: 'Dev Org' },
    })
    .catch(() => undefined);

  const { data: userRow, error: userErr } = await admin
    .from('users')
    .select('org_id')
    .eq('email', 'dev@outreach.local')
    .single();
  expect(userErr, `dev user lookup failed: ${userErr?.message}`).toBeNull();
  expect(userRow, 'dev user row not found (handle_new_user trigger may not have run)').not.toBeNull();
  const orgId = (userRow as { org_id: string }).org_id;

  // Idempotent reseed: drop prior E2E contacts (+ their touchpoints via cascade).
  await admin.from('contacts').delete().eq('org_id', orgId).eq('company', E2E_MARKER);

  const { data: campaign } = await admin
    .from('campaigns')
    .insert({ org_id: orgId, name: 'E2E AMD Campaign' })
    .select('id')
    .single();
  const campaignId = (campaign as { id: string }).id;

  const today = new Date().toISOString().slice(0, 10);
  const { data: contact } = await admin
    .from('contacts')
    .insert({
      org_id: orgId,
      campaign_id: campaignId,
      first_name: 'Vera',
      last_name: 'Voicemail',
      company: E2E_MARKER,
      mobile: MACHINE_NUMBER,
      status: 'none',
      follow_up: today,
    })
    .select('id')
    .single();
  contactId = (contact as { id: string }).id;
});

test.afterAll(async () => {
  if (!CAN_RUN) return;
  // Resolve the dev org the same way beforeAll does (orgId is local to that hook).
  const { data: userRow } = await admin
    .from('users')
    .select('org_id')
    .eq('email', 'dev@outreach.local')
    .single();
  const orgId = (userRow as { org_id: string } | null)?.org_id;
  if (!orgId) return;
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

maybeTest('AMD run auto-detects a machine and logs the voicemail touchpoint', async ({ page }) => {
  // Dev sign-in (mock).
  await page.goto('/login');
  await page.getByRole('button', { name: 'Dev sign-in (mock)' }).click();
  await expect(page).toHaveURL(/\/(\?.*)?$/);

  // Start the AMD run.
  await page.goto('/dialler/amd');
  await expect(page.getByText('Mock dialler — no real calls placed')).toBeVisible();
  await page.getByRole('button', { name: 'Start AMD Run' }).click();

  // The machine is detected and the run completes with one voicemail (live via Realtime).
  await expect(page.getByText(/1 voicemails/)).toBeVisible({ timeout: 20_000 });

  // The server auto-logged exactly one voicemail touchpoint on the contact.
  await expect
    .poll(
      async () => {
        const { data } = await admin
          .from('touchpoints')
          .select('note')
          .eq('contact_id', contactId)
          .eq('note', 'Voicemail reached — auto');
        return data?.length ?? 0;
      },
      { timeout: 20_000 },
    )
    .toBe(1);
});
