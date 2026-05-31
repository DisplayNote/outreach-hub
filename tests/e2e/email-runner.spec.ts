import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Live email-runner walk-through (PHASE_5_SPEC §12): enrol → run sender (send +
 * touchpoint + step advance) → simulate a reply (green + suppress + drops from
 * the queue) and a bounce (bounced + suppress), all on the mock driver via the
 * dev-inbox. Seeds via the service-role client; guarded to a local stack.
 */

function readEnvLocal(): Record<string, string> {
  try {
    const out: Record<string, string> = {};
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const t = line.trim();
      if (t === '' || t.startsWith('#')) continue;
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(t);
      if (!m) continue;
      let v = m[2]!.trim();
      if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
        v = v.slice(1, -1);
      }
      out[m[1]!] = v;
    }
    return out;
  } catch {
    return {};
  }
}

const env = readEnvLocal();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
function isLoopback(url: string): boolean {
  try {
    return LOOPBACK.has(new URL(url).hostname);
  } catch {
    return false;
  }
}
const CAN_RUN = SERVICE_KEY !== '' && isLoopback(SUPABASE_URL) && env.EMAIL_DRIVER === 'mock';
const maybeTest = CAN_RUN ? test : test.skip;
const E2E_MARKER = 'E2E Email Runner';

let admin: SupabaseClient;
let orgId: string;
let replyContactId: string;
let bounceContactId: string;

test.beforeAll(async () => {
  if (!CAN_RUN) return;
  admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

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
  orgId = (userRow as { org_id: string }).org_id;

  // Make the runner deterministic regardless of the real weekday (it weekend-
  // no-ops when seqSkipWeekends, and the test may run on a Sat/Sun).
  await admin.from('organizations').update({ settings: { seqSkipWeekends: false, dailyGoal: 30 } }).eq('id', orgId);

  // Idempotent reseed. Also clear the test emails' suppressions — they're keyed
  // by address (contact_id is only ON DELETE SET NULL), so a prior run's
  // reply/bounce would otherwise leave them suppressed and out of the queue.
  await admin.from('contacts').delete().eq('org_id', orgId).eq('company', E2E_MARKER);
  await admin.from('campaigns').delete().eq('org_id', orgId).eq('name', 'E2E Email Campaign');
  await admin.from('sequences').delete().eq('org_id', orgId).eq('name', E2E_MARKER);
  await admin
    .from('suppressions')
    .delete()
    .eq('org_id', orgId)
    .in('email', ['rhea@e2e.example.com', 'boris@e2e.example.com']);

  const { data: seq } = await admin
    .from('sequences')
    .insert({ org_id: orgId, name: E2E_MARKER })
    .select('id')
    .single();
  const sequenceId = (seq as { id: string }).id;
  await admin.from('sequence_steps').insert([
    { org_id: orgId, sequence_id: sequenceId, step_order: 1, day_offset: 0, channel: 'email' },
    { org_id: orgId, sequence_id: sequenceId, step_order: 2, day_offset: 3, channel: 'email' },
  ]);

  const { data: camp } = await admin
    .from('campaigns')
    .insert({ org_id: orgId, name: 'E2E Email Campaign', sequence_id: sequenceId })
    .select('id')
    .single();
  const campaignId = (camp as { id: string }).id;

  const today = new Date().toISOString().slice(0, 10);
  const mkContact = async (first: string, email: string) => {
    const { data } = await admin
      .from('contacts')
      .insert({
        org_id: orgId,
        campaign_id: campaignId,
        first_name: first,
        company: E2E_MARKER,
        email,
        status: 'none',
        sequence_day: 0,
        follow_up: today,
      })
      .select('id')
      .single();
    return (data as { id: string }).id;
  };
  replyContactId = await mkContact('Rhea', 'rhea@e2e.example.com');
  bounceContactId = await mkContact('Boris', 'boris@e2e.example.com');
});

maybeTest('email runner: send → reply (green+suppress) and bounce (bounced+suppress)', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Dev sign-in (mock)' }).click();
  await expect(page).toHaveURL(/\/(\?.*)?$/);

  await page.goto('/queue');
  await expect(page.getByText('rhea@e2e.example.com', { exact: false })).toBeVisible();

  // Simulate a reply from Rhea + a bounce for Boris while they're still queued
  // (after sending they advance out of the due list and the Sim buttons go away).
  await page.locator('li', { hasText: 'rhea@e2e.example.com' }).getByRole('button', { name: 'Sim reply' }).click();
  await expect(page.getByText(/Simulated a reply/)).toBeVisible();
  await page.locator('li', { hasText: 'boris@e2e.example.com' }).getByRole('button', { name: 'Sim bounce' }).click();
  await expect(page.getByText(/Simulated a bounce/)).toBeVisible();

  // Run the sender → both get a send event + a "Sent:" touchpoint + advance to day 3.
  await page.getByRole('button', { name: 'Run sender now' }).click();
  await expect(page.getByText(/Sent 2/)).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(async () => {
      const { count } = await admin
        .from('email_events')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('type', 'sent')
        .in('contact_id', [replyContactId, bounceContactId]);
      return count ?? 0;
    }, { timeout: 15_000 })
    .toBe(2);
  const { data: advanced } = await admin.from('contacts').select('sequence_day').eq('id', replyContactId).single();
  expect((advanced as { sequence_day: number }).sequence_day).toBe(3);

  // Scan processes the simulated inbound → reply/bounce effects.
  await page.getByRole('button', { name: 'Scan inbox now' }).click();
  await expect(page.getByText(/1 repl/)).toBeVisible({ timeout: 20_000 });

  // Reply → green + suppressed(replied); bounce → bounced + suppressed(bounced).
  await expect
    .poll(async () => {
      const { data } = await admin.from('contacts').select('status').eq('id', replyContactId).single();
      return (data as { status: string } | null)?.status ?? '';
    }, { timeout: 15_000 })
    .toBe('green');
  const { data: boris } = await admin.from('contacts').select('status').eq('id', bounceContactId).single();
  expect((boris as { status: string }).status).toBe('bounced');

  const { data: sups } = await admin.from('suppressions').select('email, reason').eq('org_id', orgId);
  const byEmail = new Map((sups ?? []).map((s) => [s.email as string, s.reason as string]));
  expect(byEmail.get('rhea@e2e.example.com')).toBe('replied');
  expect(byEmail.get('boris@e2e.example.com')).toBe('bounced');
});
