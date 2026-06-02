import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Auto-dial-next walk-through for the basic (Mode-A) dialler. Drives the real
 * stack with the mock dialler driver: with the per-user `diallerAutoDial`
 * preference on, recording an outcome on the first contact must auto-advance to
 * the next contact and place its call automatically (after the configured
 * inter-call delay) — with no second "Call" click.
 *
 * Manual mode is the default and is exercised implicitly by every other run;
 * this proves the new auto-dial wiring (settings → page → DiallerRun) end to
 * end. Seeds directly via the service-role client (reading .env.local), so it
 * runs ONLY against a local stack with a service key.
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

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
function isLoopback(url: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

const E2E_MARKER = 'E2E AutoDial';
const INTER_CALL_DELAY_SEC = 2;

// Destructive service-role seeding — local stack with a service key only.
const CAN_RUN = SERVICE_KEY !== '' && isLoopback(SUPABASE_URL);
const maybeTest = CAN_RUN ? test : test.skip;

let admin: SupabaseClient;
let userId: string;
let campaignId: string;
let priorSettings: Record<string, unknown> | null = null;

test.beforeAll(async () => {
  if (!CAN_RUN) return;
  admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Ensure the dev user/org exists (mirrors /auth/mock), then resolve both ids.
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
    .select('id, org_id')
    .eq('email', 'dev@outreach.local')
    .single();
  expect(userErr, `dev user lookup failed: ${userErr?.message}`).toBeNull();
  expect(userRow, 'dev user row not found (handle_new_user trigger may not have run)').not.toBeNull();
  userId = (userRow as { id: string }).id;
  const orgId = (userRow as { org_id: string }).org_id;

  // Idempotent reseed: drop prior E2E contacts (+ their touchpoints via cascade).
  await admin.from('contacts').delete().eq('org_id', orgId).eq('company', E2E_MARKER);

  const { data: campaign } = await admin
    .from('campaigns')
    .insert({ org_id: orgId, name: 'E2E AutoDial Campaign' })
    .select('id')
    .single();
  campaignId = (campaign as { id: string }).id;

  const today = new Date().toISOString().slice(0, 10);
  await admin.from('contacts').insert([
    {
      org_id: orgId,
      campaign_id: campaignId,
      first_name: 'Aldo',
      last_name: 'Auto',
      company: E2E_MARKER,
      mobile: '+447700900010',
      status: 'none',
      follow_up: today,
    },
    {
      org_id: orgId,
      campaign_id: campaignId,
      first_name: 'Bea',
      last_name: 'Auto',
      company: E2E_MARKER,
      mobile: '+447700900011',
      status: 'none',
      follow_up: today,
    },
  ]);

  // Stash the dev user's existing settings, then enable auto-dial with a short
  // inter-call delay. Restored in afterAll so we don't leave auto-dial on.
  const { data: existing } = await admin
    .from('user_settings')
    .select('settings')
    .eq('user_id', userId)
    .maybeSingle();
  priorSettings = (existing as { settings: Record<string, unknown> } | null)?.settings ?? null;

  await admin.from('user_settings').upsert(
    {
      user_id: userId,
      org_id: orgId,
      settings: {
        ...(priorSettings ?? {}),
        diallerAutoDial: true,
        diallerInterCallDelaySec: INTER_CALL_DELAY_SEC,
        diallerSynthTones: false,
      },
    },
    { onConflict: 'user_id' },
  );
});

test.afterAll(async () => {
  if (!CAN_RUN || !userId) return;
  // Restore the dev user's prior dialler settings (or clear the keys we set).
  const { data: userRow } = await admin
    .from('users')
    .select('org_id')
    .eq('id', userId)
    .single();
  const orgId = (userRow as { org_id: string } | null)?.org_id;
  if (!orgId) return;
  await admin
    .from('user_settings')
    .upsert(
      { user_id: userId, org_id: orgId, settings: priorSettings ?? {} },
      { onConflict: 'user_id' },
    );

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
});

maybeTest('auto-dials the next contact after an outcome is recorded', async ({ page }) => {
  expect(campaignId, 'seeded campaign id missing').toBeTruthy();

  // Dev sign-in (mock).
  await page.goto('/login');
  await page.getByRole('button', { name: 'Dev sign-in (mock)' }).click();
  await expect(page).toHaveURL(/\/(\?.*)?$/);

  // Open the dialler scoped to just the two seeded contacts.
  await page.goto(`/dialler?campaign=${campaignId}`);
  await expect(page.getByText('Call 1 of 2')).toBeVisible();

  // Run the first call to completion, then record an outcome.
  await page.getByRole('button', { name: 'Call', exact: true }).click();
  await expect(page.getByText('What happened?')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'No answer' }).click();

  // Auto-dial: the queue advances to the second contact and the inter-call
  // countdown appears — no manual "Call" click.
  await expect(page.getByText('Call 2 of 2')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Auto-dialling in \d+s/)).toBeVisible({ timeout: 5_000 });

  // The second call then places itself and runs to the outcome stage on its own.
  await expect(page.getByText('What happened?')).toBeVisible({ timeout: 15_000 });

  // Recording the second outcome completes the queue.
  await page.getByRole('button', { name: 'No answer' }).click();
  await expect(page.getByText('Queue complete')).toBeVisible({ timeout: 10_000 });
});
