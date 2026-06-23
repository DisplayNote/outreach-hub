'use server';

/**
 * Write-layer Server Action for per-user settings.
 *
 * Per-user settings live in a single `user_settings.settings` jsonb column (NOT
 * NULL default '{}'), one row per user, RLS-scoped to the owning user. Mirrors
 * `updateOrgSettings` (lib/actions/settings.ts): we merge a zod-validated
 * partial patch into the existing object rather than overwriting it, so callers
 * can update one field without clobbering the rest. The write is an upsert keyed
 * on `user_id`, carrying `org_id` so the INSERT/UPDATE WITH CHECK can pin the
 * row to the caller's org.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/org';
// mergeOrgSettingsPatch is generic over any jsonb settings blob (it just skips
// `undefined` values onto a null-prototype target) — reuse it for user settings.
import { mergeOrgSettingsPatch } from '@/lib/org-settings';
import type { UserSettings } from '@/lib/types/domain';

// --- Validation ---------------------------------------------------------------

// Known, all-optional per-user settings mirroring `UserSettings`.
// `.passthrough()` keeps unknown keys (the type carries an index signature), so
// the schema need not enumerate every future setting — matches the org schema.
const userSettingsPatchSchema = z
  .object({
    dailyGoal: z.number().int().nonnegative().optional(),
    weeklyCallsGoal: z.number().int().nonnegative().optional(),
    weeklyEmailsGoal: z.number().int().nonnegative().optional(),
    rhythmGreen: z.number().int().nonnegative().optional(),
    rhythmAmber: z.number().int().nonnegative().optional(),
    rhythmRed: z.number().int().nonnegative().optional(),
    rhythmNone: z.number().int().nonnegative().optional(),
    signature: z.string().optional(),
    // Trim each snippet and drop blanks; an absent array means "no change".
    noteSnippets: z.array(z.string().trim().min(1)).optional(),
    txSipUser: z.string().optional(),
    txCallerId: z.string().optional(),
    diallerInterCallDelaySec: z.number().int().nonnegative().optional(),
    diallerAutoDial: z.boolean().optional(),
    diallerSynthTones: z.boolean().optional(),
  })
  .passthrough();

export type UpdateUserSettingsInput = z.input<typeof userSettingsPatchSchema>;

// --- Action -------------------------------------------------------------------

export async function updateUserSettings(patch: UpdateUserSettingsInput): Promise<UserSettings> {
  const parsed = userSettingsPatchSchema.parse(patch);
  const { id: userId, orgId } = await getCurrentUser();
  const supabase = await createClient();

  // Read-merge-write: load the caller's current settings (RLS-scoped to their
  // own row), shallow-merge the patch (skipping `undefined` so blank fields are
  // a no-op), then upsert the whole object back. Postgres has no portable
  // partial-jsonb-merge via PostgREST, so we merge in JS.
  const { data: current, error: readError } = await supabase
    .from('user_settings')
    .select('settings')
    .eq('user_id', userId)
    .maybeSingle();

  if (readError) {
    throw new Error(
      `updateUserSettings: failed to load settings for user ${userId}: ${readError.message}`,
    );
  }

  const existing = ((current as { settings: Record<string, unknown> | null } | null)?.settings ??
    {}) as Record<string, unknown>;
  const merged = mergeOrgSettingsPatch(existing, parsed);

  const { data, error } = await supabase
    .from('user_settings')
    .upsert({ user_id: userId, org_id: orgId, settings: merged }, { onConflict: 'user_id' })
    .select('settings')
    .single();

  if (error) {
    throw new Error(
      `updateUserSettings: failed to upsert settings for user ${userId}: ${error.message}`,
    );
  }

  const settings = ((data as { settings: Record<string, unknown> | null } | null)?.settings ??
    {}) as UserSettings;
  revalidatePath('/settings');
  return settings;
}
