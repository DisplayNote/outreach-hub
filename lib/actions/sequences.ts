'use server';

/**
 * Phase 2 write-layer Server Actions for sequences and their ordered steps.
 *
 * Inputs are zod-validated and mapped from camelCase action shapes to the
 * Drizzle columns. Mutations run inside `withRls(rlsCtxFromSession(...))` so the
 * session GUCs scope every query to the caller's org: INSERTs set `org_id`
 * explicitly (via `getCurrentOrgId`) so the RLS WITH CHECK passes; UPDATE/DELETE
 * are implicitly org-filtered and target by `id` only. Affected routes are
 * revalidated after success.
 *
 * Steps are appended at the next `step_order` (max within the sequence + 1, or
 * 1 for the first step). The DB enforces a unique (sequence_id, step_order), so
 * a racing concurrent insert surfaces as a unique-violation error rather than a
 * silently duplicated order.
 */
import { revalidatePath } from 'next/cache';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { withRls } from '@/lib/db/rls';
import { rlsCtxFromSession, requireSession } from '@/lib/auth/session';
import { sequences, sequenceSteps } from '@/lib/db/schema';
import { getCurrentOrgId } from '@/lib/auth/org';
import type { Sequence, SequenceStep, TouchpointChannel } from '@/lib/types/domain';
import { TOUCHPOINT_CHANNELS } from '@/lib/types/domain';

// --- Row → domain mappers -----------------------------------------------------

type SequenceRow = typeof sequences.$inferSelect;
type SequenceStepRow = typeof sequenceSteps.$inferSelect;

function toSequence(row: SequenceRow): Sequence {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSequenceStep(row: SequenceStepRow): SequenceStep {
  return {
    id: row.id,
    orgId: row.orgId,
    sequenceId: row.sequenceId,
    stepOrder: row.stepOrder,
    dayOffset: row.dayOffset,
    channel: row.channel,
    templateId: row.templateId,
    createdAt: row.createdAt,
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
  const session = await requireSession();

  const sequence = await withRls(rlsCtxFromSession(session), async (tx) => {
    // org_id is set explicitly so the RLS WITH CHECK on insert passes.
    const [data] = await tx
      .insert(sequences)
      .values({ orgId, name: parsed.name })
      .returning();

    if (!data) {
      throw new Error('createSequence: failed to insert sequence: no row returned');
    }

    return toSequence(data);
  });

  revalidateSequenceRoutes();
  return sequence;
}

export async function updateSequence(
  id: string,
  input: UpdateSequenceInput,
): Promise<Sequence> {
  const sequenceId = uuid.parse(id);
  const parsed = updateSequenceSchema.parse(input);
  const session = await requireSession();

  const sequence = await withRls(rlsCtxFromSession(session), async (tx) => {
    // UPDATE is implicitly org-filtered by RLS; target by id only.
    const [data] = await tx
      .update(sequences)
      .set({ name: parsed.name })
      .where(eq(sequences.id, sequenceId))
      .returning();

    if (!data) {
      throw new Error(
        `updateSequence: failed to update sequence ${sequenceId}: no row (not found or not in your org)`,
      );
    }

    return toSequence(data);
  });

  revalidateSequenceRoutes();
  return sequence;
}

export async function deleteSequence(id: string): Promise<{ id: string }> {
  const sequenceId = uuid.parse(id);
  const session = await requireSession();

  // Steps are removed by the `on delete cascade` FK on sequence_steps.
  // Require a returned row so a no-match (stale id, or another org's sequence
  // hidden by RLS) is a clear error rather than a false success confirmation.
  await withRls(rlsCtxFromSession(session), async (tx) => {
    const deleted = await tx
      .delete(sequences)
      .where(eq(sequences.id, sequenceId))
      .returning({ id: sequences.id });

    if (deleted.length === 0) {
      throw new Error(`deleteSequence: sequence ${sequenceId} not found (or not in your org).`);
    }
  });

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
  const session = await requireSession();

  const step = await withRls(rlsCtxFromSession(session), async (tx) => {
    // Determine the next step_order: max(step_order) + 1 within this sequence,
    // or 1 if it has no steps yet. RLS scopes the read to the caller's org. The
    // unique (sequence_id, step_order) index is the source of truth — a racing
    // concurrent append surfaces as a unique-violation on insert below.
    const [lastStep] = await tx
      .select({ stepOrder: sequenceSteps.stepOrder })
      .from(sequenceSteps)
      .where(eq(sequenceSteps.sequenceId, seqId))
      .orderBy(desc(sequenceSteps.stepOrder))
      .limit(1);

    const lastOrder = lastStep?.stepOrder ?? 0;
    const nextOrder = lastOrder + 1;

    // org_id is set explicitly so the RLS WITH CHECK on insert passes.
    const [data] = await tx
      .insert(sequenceSteps)
      .values({
        orgId,
        sequenceId: seqId,
        stepOrder: nextOrder,
        dayOffset: parsed.dayOffset,
        channel: parsed.channel,
        templateId: parsed.templateId ?? null,
      })
      .returning();

    if (!data) {
      throw new Error(
        `addSequenceStep: failed to insert step for sequence ${seqId}: no row returned`,
      );
    }

    return toSequenceStep(data);
  });

  revalidateSequenceRoutes();
  return step;
}

export async function updateSequenceStep(
  id: string,
  input: UpdateSequenceStepInput,
): Promise<SequenceStep> {
  const stepId = uuid.parse(id);
  const parsed = updateSequenceStepSchema.parse(input);
  const session = await requireSession();

  const patch: Partial<typeof sequenceSteps.$inferInsert> = {};
  if (parsed.dayOffset !== undefined) {
    patch.dayOffset = parsed.dayOffset;
  }
  if (parsed.channel !== undefined) {
    patch.channel = parsed.channel;
  }
  if (parsed.templateId !== undefined) {
    patch.templateId = parsed.templateId;
  }

  if (Object.keys(patch).length === 0) {
    throw new Error('updateSequenceStep: no fields to update');
  }

  const step = await withRls(rlsCtxFromSession(session), async (tx) => {
    // UPDATE is implicitly org-filtered by RLS; target by id only.
    const [data] = await tx
      .update(sequenceSteps)
      .set(patch)
      .where(eq(sequenceSteps.id, stepId))
      .returning();

    if (!data) {
      throw new Error(
        `updateSequenceStep: failed to update step ${stepId}: no row (not found or not in your org)`,
      );
    }

    return toSequenceStep(data);
  });

  revalidateSequenceRoutes();
  return step;
}

export async function deleteSequenceStep(id: string): Promise<{ id: string }> {
  const stepId = uuid.parse(id);
  const session = await requireSession();

  // Require a returned row so a no-match (stale id, or another org's step hidden
  // by RLS) is a clear error rather than a false success confirmation.
  await withRls(rlsCtxFromSession(session), async (tx) => {
    const deleted = await tx
      .delete(sequenceSteps)
      .where(eq(sequenceSteps.id, stepId))
      .returning({ id: sequenceSteps.id });

    if (deleted.length === 0) {
      throw new Error(`deleteSequenceStep: step ${stepId} not found (or not in your org).`);
    }
  });

  revalidateSequenceRoutes();
  return { id: stepId };
}
