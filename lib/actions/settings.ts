'use server';

/**
 * Phase 2 write-layer Server Action for org-level settings.
 *
 * Settings live in a single `organizations.settings` jsonb column (NOT NULL
 * default '{}'). We merge a zod-validated partial patch into the existing
 * object rather than overwriting it, so callers can update one field without
 * clobbering the rest. The update is targeted by `id = getCurrentOrgId()` and
 * RLS additionally scopes it to the caller's own org.
 */
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { withRls } from '@/lib/db/rls';
import { rlsCtxFromSession } from '@/lib/auth/session';
import { organizations } from '@/lib/db/schema';
import { getCurrentOrgId } from '@/lib/auth/org';
import { requireAdmin } from '@/lib/auth/admin';
import { normaliseCallingCode } from '@/lib/dialler/normalise';
import { mergeOrgSettingsPatch } from '@/lib/org-settings';
import type { OrgSettings } from '@/lib/types/domain';

// --- Validation ---------------------------------------------------------------

// `defaultCountryCode` is consumed by phone normalisation/dialling as a numeric
// calling code (e.g. `+44`), NOT an ISO country code. Validate + normalise it
// to a canonical `+<digits>` form so a non-numeric value (e.g. "GB") can never
// be persisted and silently break `normalisePhone`.
const callingCodeSchema = z.string().transform((value, ctx) => {
  const normalised = normaliseCallingCode(value);
  if (normalised === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Default country code must be a numeric calling code, e.g. +44',
    });
    return z.NEVER;
  }
  return normalised;
});

// Known, all-optional settings mirroring `OrgSettings`. `.passthrough()` keeps
// any unknown keys the caller supplies (the type carries an index signature),
// so the schema does not have to enumerate every future setting. `.strict()`
// is deliberately NOT used here for that reason.
const orgSettingsPatchSchema = z
  .object({
    // Account-tier (edited in /admin). Per-user keys (goals, rhythm, signature,
    // snippets, dialler identity) moved to user_settings — see UserSettings.
    seqDailyCap: z.number().int().nonnegative().optional(),
    // Send-window hours, 0–23 (UK time). The admin form posts plain hour numbers.
    seqSendWindowFrom: z.number().int().min(0).max(23).optional(),
    seqSendWindowTo: z.number().int().min(0).max(23).optional(),
    seqSkipWeekends: z.boolean().optional(),
    defaultCountryCode: callingCodeSchema.optional(),
    zohoCrmUrl: z.string().url().optional(),
  })
  .passthrough();

export type UpdateOrgSettingsInput = z.input<typeof orgSettingsPatchSchema>;

// --- Action -------------------------------------------------------------------

export async function updateOrgSettings(patch: UpdateOrgSettingsInput): Promise<OrgSettings> {
  // Account-tier settings (daily cap, send window, …) are admin-only. The /admin
  // page wrapper already gates rendering, but this 'use server' action is its own
  // RPC entry point — re-assert admin here so a non-admin member can't invoke it
  // directly (RLS only scopes it to the org, not to admins). notFound() on miss.
  const admin = await requireAdmin();
  const parsed = orgSettingsPatchSchema.parse(patch);
  const orgId = await getCurrentOrgId();

  // Read-merge-write inside one RLS-scoped transaction: load the current
  // settings, shallow-merge the patch, write the whole object back. Postgres has
  // no portable single-statement partial-jsonb merge for our case, so we merge in
  // JS. The session GUCs set by withRls scope both the read and the write to the
  // caller's org; the explicit `id = orgId` predicate targets the single row.
  const settings = await withRls(
    rlsCtxFromSession({
      userId: admin.id,
      email: admin.email,
      orgId: admin.orgId,
      role: admin.role,
    }),
    async (tx) => {
      const [current] = await tx
        .select({ settings: organizations.settings })
        .from(organizations)
        .where(eq(organizations.id, orgId));

      if (!current) {
        throw new Error(`updateOrgSettings: failed to load settings for org ${orgId}: not found`);
      }

      const existing = (current.settings ?? {}) as Record<string, unknown>;
      // Skip `undefined` patch values so blank form fields mean "no change" rather
      // than deleting the stored value — see mergeOrgSettingsPatch for the why.
      const merged = mergeOrgSettingsPatch(existing, parsed);

      const [updated] = await tx
        .update(organizations)
        .set({ settings: merged as OrgSettings })
        .where(eq(organizations.id, orgId))
        .returning({ settings: organizations.settings });

      if (!updated) {
        throw new Error(`updateOrgSettings: failed to update settings for org ${orgId}: no row`);
      }

      return (updated.settings ?? {}) as OrgSettings;
    },
  );

  revalidatePath('/settings');
  return settings;
}
