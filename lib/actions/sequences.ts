'use server';

/**
 * Phase 2 write-layer Server Actions for sequences and their ordered steps.
 *
 * Inputs are zod-validated and mapped from camelCase action shapes to the
 * snake_case Postgres columns. Mutations run through the RLS-scoped server
 * client (`@/lib/supabase/server`): INSERTs set `org_id` explicitly (via
 * `getCurrentOrgId`) so the RLS WITH CHECK passes; UPDATE/DELETE are implicitly
 * org-filtered and target by `id` only. Affected routes are revalidated after
 * success.
 *
 * Steps are appended at the next `step_order` (max within the sequence + 1, or
 * 1 for the first step). The DB enforces a unique (sequence_id, step_order), so
 * a racing concurrent insert surfaces as a unique-violation error rather than a
 * silently duplicated order.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getCurrentOrgId } from '@/lib/auth/org';
import type { Sequence, SequenceStep, TouchpointChannel } from '@/lib/types/domain';
import { TOUCHPOINT_CHANNELS } from '@/lib/types/domain';

// --- Raw row shapes (snake_case, exactly as returned by PostgREST) -----------

interface SequenceRow {
  id: string;
  org_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface SequenceStepRow {
  id: string;
  org_id: string;
  sequence_id: string;
  step_order: number;
  day_offset: number;
  channel: TouchpointChannel;
  template_id: string | null;
  created_at: string;
}

const SEQUENCE_SELECT = 'id, org_id, name, created_at, updated_at';

const SEQUENCE_STEP_SELECT =
  'id, org_id, sequence_id, step_order, day_offset, channel, template_id, created_at';

function toSequence(row: SequenceRow): Sequence {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSequenceStep(row: SequenceStepRow): SequenceStep {
  return {
    id: row.id,
    orgId: row.org_id,
    sequenceId: row.sequence_id,
    stepOrder: row.step_order,
    dayOffset: row.day_offset,
    channel: row.channel,
    templateId: row.template_id,
    createdAt: row.created_at,
  };
}

/** Routes whose rendered output depends on sequence / step data. */
function revalidateSequenceRoutes(): void {
  revalidatePath('/sequences');
}

// --- Validation schemas -------------------------------------------------------

const uuid = z.string().uuid();

const channelSchema = z.enum(
  TOUCHPOINT_CHANNELS as unknown as [TouchpointChannel, ...TouchpointChannel[]],
);

const createSequenceSchema = z.object({
  name: z.string().trim().min(1, 'name is required'),
});

const updateSequenceSchema = z
  .object({
    name: z.string().trim().min(1, 'name is required'),
  })
  .strict();

const addSequenceStepSchema = z.object({
  dayOffset: z.number().int().nonnegative(),
  channel: channelSchema,
  templateId: uuid.nullable().optional(),
});

const updateSequenceStepSchema = z
  .object({
    dayOffset: z.number().int().nonnegative().optional(),
    channel: channelSchema.optional(),
    templateId: uuid.nullable().optional(),
  })
  .strict();

export type CreateSequenceInput = z.input<typeof createSequenceSchema>;
export type UpdateSequenceInput = z.input<typeof updateSequenceSchema>;
export type AddSequenceStepInput = z.input<typeof addSequenceStepSchema>;
export type UpdateSequenceStepInput = z.input<typeof updateSequenceStepSchema>;

// --- Sequence actions ---------------------------------------------------------

export async function createSequence(input: CreateSequenceInput): Promise<Sequence> {
  const parsed = createSequenceSchema.parse(input);
  const orgId = await getCurrentOrgId();
  const supabase = await createClient();

  const row: Record<string, unknown> = {
    org_id: orgId,
    name: parsed.name,
  };

  const { data, error } = await supabase
    .from('sequences')
    .insert(row)
    .select(SEQUENCE_SELECT)
    .single();

  if (error) {
    throw new Error(`createSequence: failed to insert sequence: ${error.message}`);
  }

  const sequence = toSequence(data as SequenceRow);
  revalidateSequenceRoutes();
  return sequence;
}

export async function updateSequence(
  id: string,
  input: UpdateSequenceInput,
): Promise<Sequence> {
  const sequenceId = uuid.parse(id);
  const parsed = updateSequenceSchema.parse(input);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('sequences')
    .update({ name: parsed.name })
    .eq('id', sequenceId)
    .select(SEQUENCE_SELECT)
    .single();

  if (error) {
    throw new Error(`updateSequence: failed to update sequence ${sequenceId}: ${error.message}`);
  }

  const sequence = toSequence(data as SequenceRow);
  revalidateSequenceRoutes();
  return sequence;
}

export async function deleteSequence(id: string): Promise<{ id: string }> {
  const sequenceId = uuid.parse(id);
  const supabase = await createClient();

  // Steps are removed by the `on delete cascade` FK on sequence_steps.
  // Require a returned row so a no-match (stale id, or another org's sequence
  // hidden by RLS) is a clear error rather than a false success confirmation.
  const { data, error } = await supabase.from('sequences').delete().eq('id', sequenceId).select('id');

  if (error) {
    throw new Error(`deleteSequence: failed to delete sequence ${sequenceId}: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error(`deleteSequence: sequence ${sequenceId} not found (or not in your org).`);
  }

  revalidateSequenceRoutes();
  return { id: sequenceId };
}

// --- Sequence-step actions ----------------------------------------------------

export async function addSequenceStep(
  sequenceId: string,
  input: AddSequenceStepInput,
): Promise<SequenceStep> {
  const seqId = uuid.parse(sequenceId);
  const parsed = addSequenceStepSchema.parse(input);
  const orgId = await getCurrentOrgId();
  const supabase = await createClient();

  // Determine the next step_order: max(step_order) + 1 within this sequence, or
  // 1 if it has no steps yet. RLS scopes the read to the caller's org. The
  // unique (sequence_id, step_order) index is the source of truth — a racing
  // concurrent append surfaces as a unique-violation on insert below.
  const { data: lastStep, error: orderError } = await supabase
    .from('sequence_steps')
    .select('step_order')
    .eq('sequence_id', seqId)
    .order('step_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (orderError) {
    throw new Error(
      `addSequenceStep: failed to resolve next step order for sequence ${seqId}: ${orderError.message}`,
    );
  }

  const lastOrder = (lastStep as { step_order: number } | null)?.step_order ?? 0;
  const nextOrder = lastOrder + 1;

  const row: Record<string, unknown> = {
    org_id: orgId,
    sequence_id: seqId,
    step_order: nextOrder,
    day_offset: parsed.dayOffset,
    channel: parsed.channel,
    template_id: parsed.templateId ?? null,
  };

  const { data, error } = await supabase
    .from('sequence_steps')
    .insert(row)
    .select(SEQUENCE_STEP_SELECT)
    .single();

  if (error) {
    throw new Error(
      `addSequenceStep: failed to insert step for sequence ${seqId}: ${error.message}`,
    );
  }

  const step = toSequenceStep(data as SequenceStepRow);
  revalidateSequenceRoutes();
  return step;
}

export async function updateSequenceStep(
  id: string,
  input: UpdateSequenceStepInput,
): Promise<SequenceStep> {
  const stepId = uuid.parse(id);
  const parsed = updateSequenceStepSchema.parse(input);
  const supabase = await createClient();

  const patch: Record<string, unknown> = {};
  if (parsed.dayOffset !== undefined) {
    patch['day_offset'] = parsed.dayOffset;
  }
  if (parsed.channel !== undefined) {
    patch['channel'] = parsed.channel;
  }
  if (parsed.templateId !== undefined) {
    patch['template_id'] = parsed.templateId;
  }

  if (Object.keys(patch).length === 0) {
    throw new Error('updateSequenceStep: no fields to update');
  }

  const { data, error } = await supabase
    .from('sequence_steps')
    .update(patch)
    .eq('id', stepId)
    .select(SEQUENCE_STEP_SELECT)
    .single();

  if (error) {
    throw new Error(
      `updateSequenceStep: failed to update step ${stepId}: ${error.message}`,
    );
  }

  const step = toSequenceStep(data as SequenceStepRow);
  revalidateSequenceRoutes();
  return step;
}

export async function deleteSequenceStep(id: string): Promise<{ id: string }> {
  const stepId = uuid.parse(id);
  const supabase = await createClient();

  // Require a returned row so a no-match (stale id, or another org's step hidden
  // by RLS) is a clear error rather than a false success confirmation.
  const { data, error } = await supabase.from('sequence_steps').delete().eq('id', stepId).select('id');

  if (error) {
    throw new Error(`deleteSequenceStep: failed to delete step ${stepId}: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error(`deleteSequenceStep: step ${stepId} not found (or not in your org).`);
  }

  revalidateSequenceRoutes();
  return { id: stepId };
}
