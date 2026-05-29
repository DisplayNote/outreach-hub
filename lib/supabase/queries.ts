/**
 * Server-side, RLS-relying typed query helpers for the Phase 1 outreach domain.
 *
 * Every helper uses the server Supabase client from `@/lib/supabase/server`,
 * whose anon-key session is scoped by RLS to the caller's org via
 * `public.current_org_id()`. We therefore never filter by `org_id` here — the
 * database does it for us. Callers must be authenticated (these run from
 * auth-gated server components / route handlers).
 *
 * Rows come back snake_case from PostgREST; we map them to the camelCase
 * domain types. Each helper surfaces Supabase errors by throwing with a clear,
 * contextual message.
 */
import { createClient } from '@/lib/supabase/server';
import type {
  Campaign,
  Contact,
  ContactStatus,
  OrgSettings,
  PipelineStatusCount,
  Sequence,
  Template,
  Touchpoint,
  TouchpointChannel,
} from '@/lib/types/domain';
import { CONTACT_STATUSES } from '@/lib/types/domain';

// --- Raw row shapes (snake_case, exactly as returned by PostgREST) -----------

interface CampaignRow {
  id: string;
  org_id: string;
  name: string;
  sequence: string | null;
  legacy_id: number | null;
  created_at: string;
  updated_at: string;
}

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
  status: ContactStatus;
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
  channel: TouchpointChannel;
  note: string | null;
  occurred_at: string;
  legacy_id: string | null;
  created_at: string;
}

// --- Selects -----------------------------------------------------------------

const CONTACT_SELECT =
  'id, org_id, campaign_id, first_name, last_name, email, company, phone, mobile, job_title, seniority, country, linkedin, status, sequence_day, follow_up, notes, legacy_id, metadata, created_at, updated_at';

const TOUCHPOINT_SELECT =
  'id, org_id, contact_id, channel, note, occurred_at, legacy_id, created_at';

// --- Row -> domain mappers ----------------------------------------------------

function toCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    sequence: row.sequence,
    legacyId: row.legacy_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

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
    // `metadata` is NOT NULL default '{}' in Postgres, but coalesce defensively
    // in case a projection ever omits it.
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

// --- Helpers -----------------------------------------------------------------

/** Today's date as a `YYYY-MM-DD` string, in UTC, for comparison with `follow_up` (a `date`). */
function todayDateString(): string {
  // `follow_up` is a SQL `date` (no time/zone); compare against a plain UTC date.
  const isoDate = new Date().toISOString().slice(0, 10);
  return isoDate;
}

/**
 * Contacts whose follow-up is due — `follow_up` is today or earlier (overdue +
 * due today). Contacts with a null `follow_up` are excluded (nothing to chase).
 * Ordered by `follow_up` ascending so the most overdue surface first.
 */
export async function getTodayContacts(): Promise<Contact[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('contacts')
    .select(CONTACT_SELECT)
    .not('follow_up', 'is', null)
    .lte('follow_up', todayDateString())
    .order('follow_up', { ascending: true });

  if (error) {
    throw new Error(`getTodayContacts: failed to load due contacts: ${error.message}`);
  }

  return (data as ContactRow[] | null)?.map(toContact) ?? [];
}

/**
 * Pipeline rollup: contact counts grouped by status. Returns one bucket per
 * known status (in schema order), including statuses with a zero count, so the
 * UI can render a stable set of columns.
 */
export async function getPipelineSummary(): Promise<PipelineStatusCount[]> {
  const supabase = await createClient();

  // PostgREST has no GROUP BY; pull the status column and aggregate in memory.
  // RLS already scopes this to the caller's org, so the row set is bounded.
  const { data, error } = await supabase.from('contacts').select('status');

  if (error) {
    throw new Error(`getPipelineSummary: failed to load pipeline counts: ${error.message}`);
  }

  const counts = new Map<ContactStatus, number>(
    CONTACT_STATUSES.map((status) => [status, 0]),
  );

  for (const row of (data as Array<{ status: ContactStatus }> | null) ?? []) {
    counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  }

  return CONTACT_STATUSES.map((status) => ({
    status,
    count: counts.get(status) ?? 0,
  }));
}

/** All campaigns visible to the caller's org, ordered by name ascending. */
export async function listCampaigns(): Promise<Campaign[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('campaigns')
    .select('id, org_id, name, sequence, legacy_id, created_at, updated_at')
    .order('name', { ascending: true });

  if (error) {
    throw new Error(`listCampaigns: failed to load campaigns: ${error.message}`);
  }

  return (data as CampaignRow[] | null)?.map(toCampaign) ?? [];
}

/**
 * A single contact by id, or `null` if it does not exist / is not visible to
 * the caller's org (RLS returns no row for other orgs, which we surface as a
 * 404 at the page level). Uses `maybeSingle` so "no row" is not an error.
 */
export async function getContact(id: string): Promise<Contact | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('contacts')
    .select(CONTACT_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new Error(`getContact: failed to load contact ${id}: ${error.message}`);
  }

  return data ? toContact(data as ContactRow) : null;
}

/**
 * The full touchpoint history for one contact, most recent first. Ordered by
 * `occurred_at` descending (ties broken by `created_at` descending). RLS scopes
 * this to the caller's org; an unknown / cross-org contact id yields `[]`.
 */
export async function getContactTouchpoints(contactId: string): Promise<Touchpoint[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('touchpoints')
    .select(TOUCHPOINT_SELECT)
    .eq('contact_id', contactId)
    .order('occurred_at', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(
      `getContactTouchpoints: failed to load touchpoints for contact ${contactId}: ${error.message}`,
    );
  }

  return (data as TouchpointRow[] | null)?.map(toTouchpoint) ?? [];
}

/**
 * A contact plus the name of its parent campaign, for the contacts list view.
 * The campaign name is resolved via a PostgREST embedded join; it is non-null
 * because `contacts.campaign_id` is NOT NULL and references `campaigns`.
 */
export interface ContactWithCampaign extends Contact {
  campaignName: string;
}

/**
 * Raw row for the contacts-with-campaign join (snake_case from PostgREST).
 *
 * The embed is logically to-one (`contacts.campaign_id` is NOT NULL and
 * references `campaigns`), but PostgREST can serialise it as either a single
 * object or a single-row array; we normalise both in `campaignNameOf`.
 */
interface ContactWithCampaignRow extends ContactRow {
  campaigns: { name: string } | { name: string }[] | null;
}

/** Pull the campaign name out of PostgREST's embed (object or single-row array). */
function campaignNameOf(embed: ContactWithCampaignRow['campaigns']): string {
  if (!embed) return '—';
  const row = Array.isArray(embed) ? embed[0] : embed;
  return row?.name ?? '—';
}

/**
 * All contacts visible to the caller's org, newest-touched first, each with the
 * name of its parent campaign. RLS scopes the result to the caller's org, so we
 * don't filter by `org_id` here. Ordered by `updated_at` descending.
 */
export async function listContacts(): Promise<ContactWithCampaign[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('contacts')
    .select(`${CONTACT_SELECT}, campaigns ( name )`)
    .order('updated_at', { ascending: false });

  if (error) {
    throw new Error(`listContacts: failed to load contacts: ${error.message}`);
  }

  return (
    (data as unknown as ContactWithCampaignRow[] | null)?.map((row) => ({
      ...toContact(row),
      campaignName: campaignNameOf(row.campaigns),
    })) ?? []
  );
}

// --- Phase 2: org settings, templates, sequences -----------------------------

interface OrgSettingsRow {
  settings: Record<string, unknown> | null;
}

interface TemplateRow {
  id: string;
  org_id: string;
  name: string;
  subject: string | null;
  body: string | null;
  created_at: string;
  updated_at: string;
}

interface SequenceRow {
  id: string;
  org_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

const TEMPLATE_SELECT = 'id, org_id, name, subject, body, created_at, updated_at';

const SEQUENCE_SELECT = 'id, org_id, name, created_at, updated_at';

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

function toSequence(row: SequenceRow): Sequence {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The caller's org settings (`organizations.settings`, jsonb). RLS scopes the
 * organizations table to the caller's own org, so the single visible row is the
 * caller's — we use `maybeSingle` and coalesce a missing row / null column to an
 * empty `{}`. The stored shape is loose; we widen it to `OrgSettings`, whose
 * fields are all optional.
 */
export async function getOrgSettings(): Promise<OrgSettings> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('organizations')
    .select('settings')
    .maybeSingle();

  if (error) {
    throw new Error(`getOrgSettings: failed to load org settings: ${error.message}`);
  }

  const settings = (data as OrgSettingsRow | null)?.settings;
  return (settings ?? {}) as OrgSettings;
}

/** All templates visible to the caller's org, ordered by name ascending. */
export async function listTemplates(): Promise<Template[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('templates')
    .select(TEMPLATE_SELECT)
    .order('name', { ascending: true });

  if (error) {
    throw new Error(`listTemplates: failed to load templates: ${error.message}`);
  }

  return (data as TemplateRow[] | null)?.map(toTemplate) ?? [];
}

/** All sequences visible to the caller's org, ordered by name ascending. */
export async function listSequences(): Promise<Sequence[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('sequences')
    .select(SEQUENCE_SELECT)
    .order('name', { ascending: true });

  if (error) {
    throw new Error(`listSequences: failed to load sequences: ${error.message}`);
  }

  return (data as SequenceRow[] | null)?.map(toSequence) ?? [];
}
