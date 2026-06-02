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
  supabase: Awaited<ReturnType<typeof createClient>>,
  sequenceId: string | null,
): Promise<{ id: string | null; name: string | null }> {
  if (sequenceId === null) return { id: null, name: null };
  const { data, error } = await supabase
    .from('sequences')
    .select('id, name')
    .eq('id', sequenceId)
    .maybeSingle();
  if (error) {
    throw new Error(`failed to resolve sequence ${sequenceId}: ${error.message}`);
  }
  if (!data) {
    throw new Error('The selected sequence no longer exists — pick another sequence.');
  }
  const row = data as { id: string; name: string };
  return { id: row.id, name: row.name };
}

// --- Actions ------------------------------------------------------------------

export async function createCampaign(input: CreateCampaignInput): Promise<Campaign> {
  const parsed = createCampaignSchema.parse(input);
  const orgId = await getCurrentOrgId();
  const supabase = await createClient();

  const row: Record<string, unknown> = {
    org_id: orgId,
    name: parsed.name,
  };
  if (parsed.sequenceId !== undefined) {
    const link = await resolveSequenceLink(supabase, parsed.sequenceId);
    row['sequence_id'] = link.id;
    row['sequence'] = link.name;
  }

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
  if (parsed.sequenceId !== undefined) {
    const link = await resolveSequenceLink(supabase, parsed.sequenceId);
    patch['sequence_id'] = link.id;
    patch['sequence'] = link.name;
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
