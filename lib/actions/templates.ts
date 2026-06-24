'use server';

/**
 * Phase 2 write-layer Server Actions for email templates.
 *
 * Inputs are zod-validated and mapped from camelCase action shapes to the
 * Drizzle `templates` table columns. Mutations run inside withRls (the RLS
 * boundary): INSERT sets `org_id` explicitly (via `getCurrentOrgId`) so the RLS
 * WITH CHECK passes; UPDATE/DELETE are implicitly org-filtered by RLS and target
 * by `id` only. Affected routes are revalidated after success.
 */
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { withRls } from '@/lib/db/rls';
import { rlsCtxFromSession, requireSession } from '@/lib/auth/session';
import { templates } from '@/lib/db/schema';
import { getCurrentOrgId } from '@/lib/auth/org';
import type { Template } from '@/lib/types/domain';

// --- Row → domain mapping -----------------------------------------------------

// The Drizzle column set selected back from `templates`, matching the domain
// `Template` shape exactly (camelCase keys, same nullability as the columns).
const TEMPLATE_COLUMNS = {
  id: templates.id,
  orgId: templates.orgId,
  name: templates.name,
  subject: templates.subject,
  body: templates.body,
  createdAt: templates.createdAt,
  updatedAt: templates.updatedAt,
} as const;

function toTemplate(row: {
  id: string;
  orgId: string;
  name: string;
  subject: string | null;
  body: string | null;
  createdAt: string;
  updatedAt: string;
}): Template {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    subject: row.subject,
    body: row.body,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Routes whose rendered output depends on template data. */
function revalidateTemplateRoutes(): void {
  revalidatePath('/templates');
  // Sequence steps can reference a template, so the sequences view may change.
  revalidatePath('/sequences');
}

// --- Validation schemas -------------------------------------------------------

const uuid = z.string().uuid();

// Trimmed, non-empty string or null. Empty collapses to null so the column
// stays clean (matches the contacts/campaigns nullable-text convention).
const nullableText = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .nullable();

const createTemplateSchema = z.object({
  name: z.string().trim().min(1, 'name is required'),
  subject: nullableText.optional(),
  body: nullableText.optional(),
});

const updateTemplateSchema = z
  .object({
    name: z.string().trim().min(1, 'name is required').optional(),
    subject: nullableText.optional(),
    body: nullableText.optional(),
  })
  .strict();

export type CreateTemplateInput = z.input<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.input<typeof updateTemplateSchema>;

// --- Actions ------------------------------------------------------------------

export async function createTemplate(input: CreateTemplateInput): Promise<Template> {
  const parsed = createTemplateSchema.parse(input);
  const orgId = await getCurrentOrgId();

  // INSERT sets `org_id` explicitly so the RLS WITH CHECK (org_id =
  // current_org_id()) passes; withRls scopes the transaction to the caller's org.
  const template = await withRls(
    rlsCtxFromSession(await requireSession()),
    async (tx) => {
      const [inserted] = await tx
        .insert(templates)
        .values({
          orgId,
          name: parsed.name,
          subject: parsed.subject ?? null,
          body: parsed.body ?? null,
        })
        .returning(TEMPLATE_COLUMNS);

      if (!inserted) {
        throw new Error('createTemplate: failed to insert template: no row returned');
      }

      return toTemplate(inserted);
    },
  );

  revalidateTemplateRoutes();
  return template;
}

export async function updateTemplate(
  id: string,
  input: UpdateTemplateInput,
): Promise<Template> {
  const templateId = uuid.parse(id);
  const parsed = updateTemplateSchema.parse(input);

  const patch: { name?: string; subject?: string | null; body?: string | null } = {};
  if (parsed.name !== undefined) {
    patch.name = parsed.name;
  }
  if (parsed.subject !== undefined) {
    patch.subject = parsed.subject;
  }
  if (parsed.body !== undefined) {
    patch.body = parsed.body;
  }

  if (Object.keys(patch).length === 0) {
    throw new Error('updateTemplate: no fields to update');
  }

  // UPDATE targets by id only; RLS implicitly scopes it to the caller's org.
  const template = await withRls(
    rlsCtxFromSession(await requireSession()),
    async (tx) => {
      const [updated] = await tx
        .update(templates)
        .set(patch)
        .where(eq(templates.id, templateId))
        .returning(TEMPLATE_COLUMNS);

      if (!updated) {
        throw new Error(`updateTemplate: failed to update template ${templateId}: no row`);
      }

      return toTemplate(updated);
    },
  );

  revalidateTemplateRoutes();
  return template;
}

export async function deleteTemplate(id: string): Promise<{ id: string }> {
  const templateId = uuid.parse(id);

  // Require a returned row so a no-match (stale id, or another org's template
  // hidden by RLS) is a clear error rather than a false success confirmation.
  await withRls(rlsCtxFromSession(await requireSession()), async (tx) => {
    const deleted = await tx
      .delete(templates)
      .where(eq(templates.id, templateId))
      .returning({ id: templates.id });

    if (deleted.length === 0) {
      throw new Error(
        `deleteTemplate: template ${templateId} not found (or not in your org).`,
      );
    }
  });

  revalidateTemplateRoutes();
  return { id: templateId };
}
