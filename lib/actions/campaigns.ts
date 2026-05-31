'use server';

/**
 * Phase 2 write-layer Server Actions for campaigns.
 *
 * Inputs are zod-validated and mapped from camelCase to snake_case columns.
 * Mutations use the RLS-scoped server client: INSERT sets `org_id` explicitly
 * (so the WITH CHECK passes); UPDATE is implicitly org-filtered and targets by
 * `id`. Affected routes are revalidated after success.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getCurrentOrgId } from '@/lib/supabase/org';
import type { Campaign } from '@/lib/types/domain';

// --- Raw row shape (snake_case, exactly as returned by PostgREST) ------------

interface CampaignRow {
  id: string;
  org_id: string;
  name: string;
  sequence: string | null;
  sequence_id: string | null;
  legacy_id: number | null;
  created_at: string;
  updated_at: string;
}

const CAMPAIGN_SELECT = 'id, org_id, name, sequence, sequence_id, legacy_id, created_at, updated_at';

function toCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    sequence: row.sequence,
    sequenceId: row.sequence_id,
    legacyId: row.legacy_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

// Trimmed, non-empty string or null. Empty collapses to null.
const nullableText = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .nullable();

const createCampaignSchema = z.object({
  name: z.string().trim().min(1, 'name is required'),
  sequence: nullableText.optional(),
});

const updateCampaignSchema = z
  .object({
    name: z.string().trim().min(1, 'name is required').optional(),
    sequence: nullableText.optional(),
  })
  .strict();

export type CreateCampaignInput = z.input<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.input<typeof updateCampaignSchema>;

// --- Actions ------------------------------------------------------------------

export async function createCampaign(input: CreateCampaignInput): Promise<Campaign> {
  const parsed = createCampaignSchema.parse(input);
  const orgId = await getCurrentOrgId();
  const supabase = await createClient();

  const row: Record<string, unknown> = {
    org_id: orgId,
    name: parsed.name,
    sequence: parsed.sequence ?? null,
  };

  const { data, error } = await supabase
    .from('campaigns')
    .insert(row)
    .select(CAMPAIGN_SELECT)
    .single();

  if (error) {
    throw new Error(`createCampaign: failed to insert campaign: ${error.message}`);
  }

  const campaign = toCampaign(data as CampaignRow);
  revalidateCampaignRoutes();
  return campaign;
}

export async function updateCampaign(
  id: string,
  input: UpdateCampaignInput,
): Promise<Campaign> {
  const campaignId = uuid.parse(id);
  const parsed = updateCampaignSchema.parse(input);
  const supabase = await createClient();

  const patch: Record<string, unknown> = {};
  if (parsed.name !== undefined) {
    patch['name'] = parsed.name;
  }
  if (parsed.sequence !== undefined) {
    patch['sequence'] = parsed.sequence;
  }

  if (Object.keys(patch).length === 0) {
    throw new Error('updateCampaign: no fields to update');
  }

  const { data, error } = await supabase
    .from('campaigns')
    .update(patch)
    .eq('id', campaignId)
    .select(CAMPAIGN_SELECT)
    .single();

  if (error) {
    throw new Error(`updateCampaign: failed to update campaign ${campaignId}: ${error.message}`);
  }

  const campaign = toCampaign(data as CampaignRow);
  revalidateCampaignRoutes();
  return campaign;
}

export async function deleteCampaign(id: string): Promise<{ id: string }> {
  const campaignId = uuid.parse(id);
  const supabase = await createClient();

  const { error } = await supabase.from('campaigns').delete().eq('id', campaignId);

  if (error) {
    throw new Error(`deleteCampaign: failed to delete campaign ${campaignId}: ${error.message}`);
  }

  revalidateCampaignRoutes();
  return { id: campaignId };
}
