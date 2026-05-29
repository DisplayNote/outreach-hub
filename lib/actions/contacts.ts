'use server';

/**
 * Phase 2 write-layer Server Actions for contacts and touchpoints.
 *
 * All inputs are validated with zod and mapped from camelCase action shapes to
 * the snake_case Postgres columns. Mutations run through the RLS-scoped server
 * client (`@/lib/supabase/server`), so UPDATE/DELETE are implicitly org-filtered
 * — we target by `id` only. INSERTs set `org_id` explicitly (via
 * `getCurrentOrgId`) so the RLS WITH CHECK passes.
 *
 * After a successful mutation we revalidate every route that renders the
 * affected data so the App Router cache reflects the change.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getCurrentOrgId } from '@/lib/supabase/org';
import type { Contact, Touchpoint } from '@/lib/types/domain';
import { CONTACT_STATUSES, TOUCHPOINT_CHANNELS } from '@/lib/types/domain';

// --- Raw row shapes (snake_case, exactly as returned by PostgREST) -----------

interface ContactRow {
  id: string;
  org_id: string;
  campaign_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  company: string | null;
  phone: string | null;
  mobile: string | null;
  job_title: string | null;
  seniority: string | null;
  country: string | null;
  linkedin: string | null;
  status: Contact['status'];
  sequence_day: number | null;
  follow_up: string | null;
  notes: string | null;
  legacy_id: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

interface TouchpointRow {
  id: string;
  org_id: string;
  contact_id: string;
  channel: Touchpoint['channel'];
  note: string | null;
  occurred_at: string;
  legacy_id: string | null;
  created_at: string;
}

const CONTACT_SELECT =
  'id, org_id, campaign_id, first_name, last_name, email, company, phone, mobile, job_title, seniority, country, linkedin, status, sequence_day, follow_up, notes, legacy_id, metadata, created_at, updated_at';

const TOUCHPOINT_SELECT =
  'id, org_id, contact_id, channel, note, occurred_at, legacy_id, created_at';

// --- Row -> domain mappers ----------------------------------------------------

function toContact(row: ContactRow): Contact {
  return {
    id: row.id,
    orgId: row.org_id,
    campaignId: row.campaign_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    company: row.company,
    phone: row.phone,
    mobile: row.mobile,
    jobTitle: row.job_title,
    seniority: row.seniority,
    country: row.country,
    linkedin: row.linkedin,
    status: row.status,
    sequenceDay: row.sequence_day,
    followUp: row.follow_up,
    notes: row.notes,
    legacyId: row.legacy_id,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTouchpoint(row: TouchpointRow): Touchpoint {
  return {
    id: row.id,
    orgId: row.org_id,
    contactId: row.contact_id,
    channel: row.channel,
    note: row.note,
    occurredAt: row.occurred_at,
    legacyId: row.legacy_id,
    createdAt: row.created_at,
  };
}

// --- Revalidation -------------------------------------------------------------

/** Routes whose rendered output depends on contact/touchpoint data. */
function revalidateContactRoutes(contactId?: string): void {
  revalidatePath('/today');
  revalidatePath('/pipeline');
  revalidatePath('/contacts');
  if (contactId) {
    revalidatePath(`/contacts/${contactId}`);
  }
}

// --- Validation schemas -------------------------------------------------------

const uuid = z.string().uuid();
const contactStatusSchema = z.enum(
  CONTACT_STATUSES as unknown as [Contact['status'], ...Contact['status'][]],
);
const touchpointChannelSchema = z.enum(
  TOUCHPOINT_CHANNELS as unknown as [Touchpoint['channel'], ...Touchpoint['channel'][]],
);

// A trimmed, non-empty string or null. Empty input collapses to null so the
// column stays clean (matches how the legacy importer normalises blanks).
const nullableText = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .nullable();

// ISO date string `YYYY-MM-DD` for the `follow_up` DATE column, or null.
const nullableDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'follow_up must be a YYYY-MM-DD date')
  .nullable();

const nullableSequenceDay = z.number().int().nonnegative().nullable();

/** Editable contact fields, shared by create and update. */
const contactFields = {
  firstName: nullableText,
  lastName: nullableText,
  email: z.string().trim().email().nullable().or(z.literal('').transform(() => null)),
  company: nullableText,
  phone: nullableText,
  mobile: nullableText,
  jobTitle: nullableText,
  seniority: nullableText,
  country: nullableText,
  linkedin: nullableText,
  status: contactStatusSchema,
  sequenceDay: nullableSequenceDay,
  followUp: nullableDate,
  notes: nullableText,
};

const createContactSchema = z.object({
  campaignId: uuid,
  ...contactFields,
  // status is optional on create — DB defaults to 'none'.
  status: contactStatusSchema.optional(),
});

// All editable fields optional on update (patch semantics). campaignId may be
// reassigned but is not required.
const updateContactSchema = z
  .object({
    campaignId: uuid.optional(),
    ...contactFields,
    status: contactStatusSchema.optional(),
    firstName: contactFields.firstName.optional(),
    lastName: contactFields.lastName.optional(),
    email: contactFields.email.optional(),
    company: contactFields.company.optional(),
    phone: contactFields.phone.optional(),
    mobile: contactFields.mobile.optional(),
    jobTitle: contactFields.jobTitle.optional(),
    seniority: contactFields.seniority.optional(),
    country: contactFields.country.optional(),
    linkedin: contactFields.linkedin.optional(),
    sequenceDay: contactFields.sequenceDay.optional(),
    followUp: contactFields.followUp.optional(),
    notes: contactFields.notes.optional(),
  })
  .strict();

const logTouchpointSchema = z.object({
  channel: touchpointChannelSchema,
  note: nullableText.optional(),
  // Accept any timestamp parseable as ISO; default to now() when omitted.
  occurredAt: z.string().datetime({ offset: true }).optional(),
});

export type CreateContactInput = z.input<typeof createContactSchema>;
export type UpdateContactInput = z.input<typeof updateContactSchema>;
export type LogTouchpointInput = z.input<typeof logTouchpointSchema>;

// --- Actions ------------------------------------------------------------------

export async function createContact(input: CreateContactInput): Promise<Contact> {
  const parsed = createContactSchema.parse(input);
  const orgId = await getCurrentOrgId();
  const supabase = await createClient();

  const row: Record<string, unknown> = {
    org_id: orgId,
    campaign_id: parsed.campaignId,
    first_name: parsed.firstName,
    last_name: parsed.lastName,
    email: parsed.email,
    company: parsed.company,
    phone: parsed.phone,
    mobile: parsed.mobile,
    job_title: parsed.jobTitle,
    seniority: parsed.seniority,
    country: parsed.country,
    linkedin: parsed.linkedin,
    sequence_day: parsed.sequenceDay,
    follow_up: parsed.followUp,
    notes: parsed.notes,
  };
  if (parsed.status !== undefined) {
    row['status'] = parsed.status;
  }

  const { data, error } = await supabase
    .from('contacts')
    .insert(row)
    .select(CONTACT_SELECT)
    .single();

  if (error) {
    throw new Error(`createContact: failed to insert contact: ${error.message}`);
  }

  const contact = toContact(data as ContactRow);
  revalidateContactRoutes(contact.id);
  return contact;
}

export async function updateContact(id: string, input: UpdateContactInput): Promise<Contact> {
  const contactId = uuid.parse(id);
  const parsed = updateContactSchema.parse(input);
  const supabase = await createClient();

  // Map only the camelCase keys that were actually provided to their columns.
  const columnByKey: Record<keyof UpdateContactInput, string> = {
    campaignId: 'campaign_id',
    firstName: 'first_name',
    lastName: 'last_name',
    email: 'email',
    company: 'company',
    phone: 'phone',
    mobile: 'mobile',
    jobTitle: 'job_title',
    seniority: 'seniority',
    country: 'country',
    linkedin: 'linkedin',
    status: 'status',
    sequenceDay: 'sequence_day',
    followUp: 'follow_up',
    notes: 'notes',
  };

  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(parsed) as (keyof typeof parsed)[]) {
    const column = columnByKey[key];
    patch[column] = parsed[key];
  }

  if (Object.keys(patch).length === 0) {
    throw new Error('updateContact: no fields to update');
  }

  const { data, error } = await supabase
    .from('contacts')
    .update(patch)
    .eq('id', contactId)
    .select(CONTACT_SELECT)
    .single();

  if (error) {
    throw new Error(`updateContact: failed to update contact ${contactId}: ${error.message}`);
  }

  const contact = toContact(data as ContactRow);
  revalidateContactRoutes(contact.id);
  return contact;
}

export async function deleteContact(id: string): Promise<{ id: string }> {
  const contactId = uuid.parse(id);
  const supabase = await createClient();

  const { error } = await supabase.from('contacts').delete().eq('id', contactId);

  if (error) {
    throw new Error(`deleteContact: failed to delete contact ${contactId}: ${error.message}`);
  }

  revalidateContactRoutes(contactId);
  return { id: contactId };
}

export async function setContactStatus(
  id: string,
  status: Contact['status'],
): Promise<Contact> {
  const contactId = uuid.parse(id);
  const nextStatus = contactStatusSchema.parse(status);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('contacts')
    .update({ status: nextStatus })
    .eq('id', contactId)
    .select(CONTACT_SELECT)
    .single();

  if (error) {
    throw new Error(
      `setContactStatus: failed to set status on contact ${contactId}: ${error.message}`,
    );
  }

  const contact = toContact(data as ContactRow);
  revalidateContactRoutes(contact.id);
  return contact;
}

export async function logTouchpoint(
  contactId: string,
  input: LogTouchpointInput,
): Promise<Touchpoint> {
  const id = uuid.parse(contactId);
  const parsed = logTouchpointSchema.parse(input);
  const orgId = await getCurrentOrgId();
  const supabase = await createClient();

  const row: Record<string, unknown> = {
    org_id: orgId,
    contact_id: id,
    channel: parsed.channel,
    note: parsed.note ?? null,
    occurred_at: parsed.occurredAt ?? new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('touchpoints')
    .insert(row)
    .select(TOUCHPOINT_SELECT)
    .single();

  if (error) {
    throw new Error(
      `logTouchpoint: failed to log touchpoint for contact ${id}: ${error.message}`,
    );
  }

  const touchpoint = toTouchpoint(data as TouchpointRow);
  revalidateContactRoutes(id);
  return touchpoint;
}
