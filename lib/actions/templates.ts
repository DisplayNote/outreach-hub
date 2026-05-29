'use server';

/**
 * Phase 2 write-layer Server Actions for email templates.
 *
 * Inputs are zod-validated and mapped from camelCase action shapes to the
 * snake_case Postgres columns. Mutations run through the RLS-scoped server
 * client (`@/lib/supabase/server`): INSERT sets `org_id` explicitly (via
 * `getCurrentOrgId`) so the RLS WITH CHECK passes; UPDATE/DELETE are implicitly
 * org-filtered and target by `id` only. Affected routes are revalidated after
 * success.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getCurrentOrgId } from '@/lib/supabase/org';
import type { Template } from '@/lib/types/domain';

// --- Raw row shape (snake_case, exactly as returned by PostgREST) ------------

interface TemplateRow {
  id: string;
  org_id: string;
  name: string;
  subject: string | null;
  body: string | null;
  created_at: string;
  updated_at: string;
}

const TEMPLATE_SELECT = 'id, org_id, name, subject, body, created_at, updated_at';

function toTemplate(row: TemplateRow): Template {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    subject: row.subject,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Routes whose rendered output depends on template data. */
function revalidateTemplateRoutes(): void {
  revalidatePath('/templates');
  revalidatePath('/sequences');
  revalidatePath('/settings');
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
  const supabase = await createClient();

  const row: Record<string, unknown> = {
    org_id: orgId,
    name: parsed.name,
    subject: parsed.subject ?? null,
    body: parsed.body ?? null,
  };

  const { data, error } = await supabase
    .from('templates')
    .insert(row)
    .select(TEMPLATE_SELECT)
    .single();

  if (error) {
    throw new Error(`createTemplate: failed to insert template: ${error.message}`);
  }

  const template = toTemplate(data as TemplateRow);
  revalidateTemplateRoutes();
  return template;
}

export async function updateTemplate(
  id: string,
  input: UpdateTemplateInput,
): Promise<Template> {
  const templateId = uuid.parse(id);
  const parsed = updateTemplateSchema.parse(input);
  const supabase = await createClient();

  const patch: Record<string, unknown> = {};
  if (parsed.name !== undefined) {
    patch['name'] = parsed.name;
  }
  if (parsed.subject !== undefined) {
    patch['subject'] = parsed.subject;
  }
  if (parsed.body !== undefined) {
    patch['body'] = parsed.body;
  }

  if (Object.keys(patch).length === 0) {
    throw new Error('updateTemplate: no fields to update');
  }

  const { data, error } = await supabase
    .from('templates')
    .update(patch)
    .eq('id', templateId)
    .select(TEMPLATE_SELECT)
    .single();

  if (error) {
    throw new Error(`updateTemplate: failed to update template ${templateId}: ${error.message}`);
  }

  const template = toTemplate(data as TemplateRow);
  revalidateTemplateRoutes();
  return template;
}

export async function deleteTemplate(id: string): Promise<{ id: string }> {
  const templateId = uuid.parse(id);
  const supabase = await createClient();

  const { error } = await supabase.from('templates').delete().eq('id', templateId);

  if (error) {
    throw new Error(`deleteTemplate: failed to delete template ${templateId}: ${error.message}`);
  }

  revalidateTemplateRoutes();
  return { id: templateId };
}
