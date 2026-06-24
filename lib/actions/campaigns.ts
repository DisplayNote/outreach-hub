'use server';

/**
 * Phase 2 write-layer Server Actions for campaigns.
 *
 * Inputs are zod-validated and mapped from camelCase to snake_case columns.
 * Mutations run inside withRls (the RLS GUCs scope every query to the caller's
 * org): INSERT sets `org_id` explicitly (so the WITH CHECK passes); UPDATE is
 * implicitly org-filtered and targets by `id`. Affected routes are revalidated
 * after success.
 */
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { withRls } from '@/lib/db/rls';
import type { DrizzleTx } from '@/lib/db/rls';
import { rlsCtxFromSession, requireSession } from '@/lib/auth/session';
import { campaigns, sequences } from '@/lib/db/schema';
import { getCurrentOrgId } from '@/lib/auth/org';
import type { Campaign } from '@/lib/types/domain';

// --- Row → domain mapping -----------------------------------------------------

/** The campaign columns we read back, selected explicitly to match CampaignRow. */
const campaignColumns = {
  id: campaigns.id,
  orgId: campaigns.orgId,
  name: campaigns.name,
  sequence: campaigns.sequence,
  sequenceId: campaigns.sequenceId,
  legacyId: campaigns.legacyId,
  createdAt: campaigns.createdAt,
  updatedAt: campaigns.updatedAt,
} as const;

type CampaignRow = {
  id: string;
  orgId: string;
  name: string;
  sequence: string | null;
  sequenceId: string | null;
  legacyId: number | null;
  createdAt: string;
  updatedAt: string;
};

function toCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    sequence: row.sequence,
    sequenceId: row.sequenceId,
    legacyId: row.legacyId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Routes whose rendered output depends on campaign data. */
function revalidateCampaignRoutes(): void {
  revalidatePath('/campaigns');
  revalidatePath('/today');
  revalidatePath('/pipeline');
  revalidatePath('/contacts');
}

// --- Validation schemas -------------------------------------------------------

const uuid = z.string().uuid();

// A sequence selection from the campaign form's <select>: a real sequence UUID,
// or '' / null (the "no sequence" option) which collapses to null. Anything that
// isn't a UUID or empty is rejected before we touch the DB — so a campaign can no
// longer reference a sequence that doesn't exist. `.optional()` keeps "field
// absent" distinct from "cleared": absent → undefined → no-change on update.
const sequenceSelection = z
  .union([z.string().uuid(), z.literal(''), z.null()])
  .transform((v) => (v === '' ? null : v));

const createCampaignSchema = z.object({
  name: z.string().trim().min(1, 'name is required'),
  sequenceId: sequenceSelection.optional(),
});

const updateCampaignSchema = z
  .object({
    name: z.string().trim().min(1, 'name is required').optional(),
    sequenceId: sequenceSelection.optional(),
  })
  .strict();

export type CreateCampaignInput = z.input<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.input<typeof updateCampaignSchema>;

/**
 * Resolve a selected sequence id to the {id, name} we persist, validating it
 * exists in the caller's org (the query is RLS-scoped, and the DB FK enforces
 * the same org link on write). The name is denormalised into the display-only
 * `campaigns.sequence` column so the campaigns list can show it without a join;
 * `sequence_id` is the load-bearing link the email runner actually follows.
 */
async function resolveSequenceLink(
  tx: DrizzleTx,
  sequenceId: string | null,
): Promise<{ id: string | null; name: string | null }> {
  if (sequenceId === null) return { id: null, name: null };
  const rows = await tx
    .select({ id: sequences.id, name: sequences.name })
    .from(sequences)
    .where(eq(sequences.id, sequenceId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error('The selected sequence no longer exists — pick another sequence.');
  }
  return { id: row.id, name: row.name };
}

// --- Actions ------------------------------------------------------------------

export async function createCampaign(input: CreateCampaignInput): Promise<Campaign> {
  const parsed = createCampaignSchema.parse(input);
  const orgId = await getCurrentOrgId();

  const campaign = await withRls(
    rlsCtxFromSession(await requireSession()),
    async (tx) => {
      const values: typeof campaigns.$inferInsert = {
        orgId,
        name: parsed.name,
      };
      if (parsed.sequenceId !== undefined) {
        const link = await resolveSequenceLink(tx, parsed.sequenceId);
        values.sequenceId = link.id;
        values.sequence = link.name;
      }

      const rows = await tx.insert(campaigns).values(values).returning(campaignColumns);
      const row = rows[0];
      if (!row) {
        throw new Error('createCampaign: failed to insert campaign: no row returned');
      }
      return toCampaign(row);
    },
  );

  revalidateCampaignRoutes();
  return campaign;
}

export async function updateCampaign(
  id: string,
  input: UpdateCampaignInput,
): Promise<Campaign> {
  const campaignId = uuid.parse(id);
  const parsed = updateCampaignSchema.parse(input);

  const campaign = await withRls(
    rlsCtxFromSession(await requireSession()),
    async (tx) => {
      const patch: Partial<typeof campaigns.$inferInsert> = {};
      if (parsed.name !== undefined) {
        patch.name = parsed.name;
      }
      if (parsed.sequenceId !== undefined) {
        const link = await resolveSequenceLink(tx, parsed.sequenceId);
        patch.sequenceId = link.id;
        patch.sequence = link.name;
      }

      if (Object.keys(patch).length === 0) {
        throw new Error('updateCampaign: no fields to update');
      }

      const rows = await tx
        .update(campaigns)
        .set(patch)
        .where(eq(campaigns.id, campaignId))
        .returning(campaignColumns);
      const row = rows[0];
      if (!row) {
        throw new Error(`updateCampaign: failed to update campaign ${campaignId}: no row`);
      }
      return toCampaign(row);
    },
  );

  revalidateCampaignRoutes();
  return campaign;
}

export async function deleteCampaign(id: string): Promise<{ id: string }> {
  const campaignId = uuid.parse(id);

  await withRls(rlsCtxFromSession(await requireSession()), async (tx) => {
    // Require a returned row so a no-match (stale id, or another org's campaign
    // hidden by RLS) is a clear error rather than a false success confirmation.
    const rows = await tx
      .delete(campaigns)
      .where(eq(campaigns.id, campaignId))
      .returning({ id: campaigns.id });

    if (rows.length === 0) {
      throw new Error(`deleteCampaign: campaign ${campaignId} not found (or not in your org).`);
    }
  });

  revalidateCampaignRoutes();
  return { id: campaignId };
}
