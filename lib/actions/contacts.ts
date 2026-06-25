'use server';

/**
 * Phase 2 write-layer Server Actions for contacts and touchpoints.
 *
 * All inputs are validated with zod and mapped from the camelCase action shapes
 * to the Drizzle table columns. Mutations run inside `withRls`, scoped to the
 * caller's session, so UPDATE/DELETE are implicitly org-filtered by RLS — we
 * target by `id` only. INSERTs set `org_id` explicitly (via `getCurrentOrgId`)
 * so the RLS WITH CHECK passes. RLS remains the multi-tenant boundary; there is
 * no app-layer org filter standing in for it.
 *
 * After a successful mutation we revalidate every route that renders the
 * affected data so the App Router cache reflects the change.
 */
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { withRls } from '@/lib/db/rls';
import { requireSession, rlsCtxFromSession } from '@/lib/auth/session';
import { contacts, touchpoints } from '@/lib/db/schema';
import { getCurrentOrgId } from '@/lib/auth/org';
import type { Contact, Touchpoint } from '@/lib/types/domain';
import { CONTACT_STATUSES, TOUCHPOINT_CHANNELS } from '@/lib/types/domain';

// --- Row -> domain mappers ----------------------------------------------------
//
// The Drizzle column defs (lib/db/schema.ts) are typed so a selected row
// deserialises straight to the domain field types (ISO timestamps as strings,
// follow_up as 'YYYY-MM-DD', legacy_id as number|null, metadata as the map).
// These mappers exist only to pin the explicit shape the actions return.

type ContactSelect = typeof contacts.$inferSelect;
type TouchpointSelect = typeof touchpoints.$inferSelect;

function toContact(row: ContactSelect): Contact {
  return {
    id: row.id,
    orgId: row.orgId,
    campaignId: row.campaignId,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    company: row.company,
    phone: row.phone,
    mobile: row.mobile,
    jobTitle: row.jobTitle,
    seniority: row.seniority,
    country: row.country,
    linkedin: row.linkedin,
    status: row.status,
    sequenceDay: row.sequenceDay,
    followUp: row.followUp,
    lastEmailedAt: row.lastEmailedAt,
    notes: row.notes,
    legacyId: row.legacyId,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toTouchpoint(row: TouchpointSelect): Touchpoint {
  return {
    id: row.id,
    orgId: row.orgId,
    contactId: row.contactId,
    channel: row.channel,
    note: row.note,
    occurredAt: row.occurredAt,
    legacyId: row.legacyId,
    createdAt: row.createdAt,
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
  const session = await requireSession();

  // org_id is set explicitly so the RLS WITH CHECK passes; campaign_id carries
  // the (composite-FK-safe) campaign reference. The DB default fills `status`
  // ('none') when the caller omits it, so only set it when provided.
  const values: typeof contacts.$inferInsert = {
    orgId,
    campaignId: parsed.campaignId,
    firstName: parsed.firstName,
    lastName: parsed.lastName,
    email: parsed.email,
    company: parsed.company,
    phone: parsed.phone,
    mobile: parsed.mobile,
    jobTitle: parsed.jobTitle,
    seniority: parsed.seniority,
    country: parsed.country,
    linkedin: parsed.linkedin,
    sequenceDay: parsed.sequenceDay,
    followUp: parsed.followUp,
    notes: parsed.notes,
  };
  if (parsed.status !== undefined) {
    values.status = parsed.status;
  }

  const contact = await withRls(rlsCtxFromSession(session), async (tx) => {
    const [row] = await tx.insert(contacts).values(values).returning();
    if (!row) {
      throw new Error('createContact: failed to insert contact: no row returned');
    }
    return toContact(row);
  });

  revalidateContactRoutes(contact.id);
  return contact;
}

export async function updateContact(id: string, input: UpdateContactInput): Promise<Contact> {
  const contactId = uuid.parse(id);
  const parsed = updateContactSchema.parse(input);
  const session = await requireSession();

  // Map only the camelCase keys that were actually provided onto the matching
  // Drizzle columns. The keys here are the schema's camelCase column names.
  const columnByKey: Record<keyof UpdateContactInput, keyof typeof contacts.$inferInsert> = {
    campaignId: 'campaignId',
    firstName: 'firstName',
    lastName: 'lastName',
    email: 'email',
    company: 'company',
    phone: 'phone',
    mobile: 'mobile',
    jobTitle: 'jobTitle',
    seniority: 'seniority',
    country: 'country',
    linkedin: 'linkedin',
    status: 'status',
    sequenceDay: 'sequenceDay',
    followUp: 'followUp',
    notes: 'notes',
  };

  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(parsed) as (keyof typeof parsed)[]) {
    const value = parsed[key];
    // zod preserves keys whose value is explicitly `undefined`; skip those so a
    // not-provided field is a true no-op rather than an effectively-empty update
    // body (JSON drops undefined). `null` is kept — it means "clear the field".
    if (value === undefined) continue;
    patch[columnByKey[key]] = value;
  }

  if (Object.keys(patch).length === 0) {
    throw new Error('updateContact: no fields to update');
  }

  const contact = await withRls(rlsCtxFromSession(session), async (tx) => {
    // Target by id only — RLS scopes the UPDATE to the caller's org.
    const [row] = await tx
      .update(contacts)
      .set(patch as Partial<typeof contacts.$inferInsert>)
      .where(eq(contacts.id, contactId))
      .returning();
    if (!row) {
      throw new Error(
        `updateContact: failed to update contact ${contactId}: not found (or not in your org).`,
      );
    }
    return toContact(row);
  });

  revalidateContactRoutes(contact.id);
  return contact;
}

export async function deleteContact(id: string): Promise<{ id: string }> {
  const contactId = uuid.parse(id);
  const session = await requireSession();

  await withRls(rlsCtxFromSession(session), async (tx) => {
    // Require a returned row: a delete that matches nothing (stale/unknown id, or
    // a contact in another org filtered by RLS) raises no error, so without this
    // the UI would falsely confirm a delete that didn't happen — and a successful
    // "delete" of another org's id would confirm that resource exists.
    const deleted = await tx
      .delete(contacts)
      .where(eq(contacts.id, contactId))
      .returning({ id: contacts.id });
    if (deleted.length === 0) {
      throw new Error(`deleteContact: contact ${contactId} not found (or not in your org).`);
    }
  });

  revalidateContactRoutes(contactId);
  return { id: contactId };
}

export async function setContactStatus(
  id: string,
  status: Contact['status'],
): Promise<Contact> {
  const contactId = uuid.parse(id);
  const nextStatus = contactStatusSchema.parse(status);
  const session = await requireSession();

  const contact = await withRls(rlsCtxFromSession(session), async (tx) => {
    const [row] = await tx
      .update(contacts)
      .set({ status: nextStatus })
      .where(eq(contacts.id, contactId))
      .returning();
    if (!row) {
      throw new Error(
        `setContactStatus: failed to set status on contact ${contactId}: not found (or not in your org).`,
      );
    }
    return toContact(row);
  });

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
  const session = await requireSession();

  const values: typeof touchpoints.$inferInsert = {
    orgId,
    contactId: id,
    channel: parsed.channel,
    note: parsed.note ?? null,
    occurredAt: parsed.occurredAt ?? new Date().toISOString(),
  };

  const touchpoint = await withRls(rlsCtxFromSession(session), async (tx) => {
    const [row] = await tx.insert(touchpoints).values(values).returning();
    if (!row) {
      throw new Error(
        `logTouchpoint: failed to log touchpoint for contact ${id}: no row returned`,
      );
    }
    return toTouchpoint(row);
  });

  revalidateContactRoutes(id);
  return touchpoint;
}
