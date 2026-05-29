/**
 * TypeScript domain types for the Phase 1 outreach schema.
 *
 * These mirror the snake_case Postgres tables defined in
 * supabase/migrations/20260529120000_phase1_domain.sql as camelCase TS shapes.
 * Nullable columns are typed `T | null`; columns with a NOT NULL default are
 * always present and non-null on read.
 *
 * Under exactOptionalPropertyTypes, every property here is required on the
 * type (a row always has the column) — absence is modelled with `null`, never
 * with an optional `?` field, to match how Postgres returns rows.
 */

/** public.contact_status enum — verbatim, lower-case members. */
export type ContactStatus =
  | 'none'
  | 'amber'
  | 'red'
  | 'green'
  | 'meeting'
  | 'notinterested'
  | 'bounced';

/** All possible contact statuses, in schema declaration order. */
export const CONTACT_STATUSES: readonly ContactStatus[] = [
  'none',
  'amber',
  'red',
  'green',
  'meeting',
  'notinterested',
  'bounced',
] as const;

/** public.touchpoint_channel enum — verbatim, lower-case members. */
export type TouchpointChannel = 'email' | 'phone' | 'linkedin' | 'other';

/** All possible touchpoint channels, in schema declaration order. */
export const TOUCHPOINT_CHANNELS: readonly TouchpointChannel[] = [
  'email',
  'phone',
  'linkedin',
  'other',
] as const;

/**
 * public.campaigns row.
 *
 * `sequence` is nullable text; `legacyId` is the nullable int used by the
 * importer for idempotent upsert.
 */
export interface Campaign {
  id: string;
  orgId: string;
  name: string;
  sequence: string | null;
  legacyId: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * public.contacts row.
 *
 * Most descriptive fields are nullable text. `status` is NOT NULL (defaults to
 * 'none'). `followUp` is a nullable `date` — serialised as an ISO date string
 * (`YYYY-MM-DD`) by PostgREST. `legacyId` is the nullable int upsert key.
 */
export interface Contact {
  id: string;
  orgId: string;
  campaignId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  company: string | null;
  phone: string | null;
  mobile: string | null;
  jobTitle: string | null;
  seniority: string | null;
  country: string | null;
  linkedin: string | null;
  status: ContactStatus;
  sequenceDay: number | null;
  followUp: string | null;
  notes: string | null;
  legacyId: number | null;
  /**
   * public.contacts.metadata (jsonb, NOT NULL default '{}'). Free-form
   * extension map for enrichment fields (e.g. Apollo) that have no dedicated
   * column. Always present (never null); an empty row is `{}`.
   */
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * public.touchpoints row.
 *
 * Immutable append-only log: there is no `updatedAt`. `channel` is NOT NULL.
 * `occurredAt` is the event timestamp (timestamptz, ISO string). `legacyId` is
 * the nullable text upsert key.
 */
export interface Touchpoint {
  id: string;
  orgId: string;
  contactId: string;
  channel: TouchpointChannel;
  note: string | null;
  occurredAt: string;
  legacyId: string | null;
  createdAt: string;
}

/** One bucket of the pipeline-by-status rollup. */
export interface PipelineStatusCount {
  status: ContactStatus;
  count: number;
}

/**
 * public.templates row.
 *
 * Reusable email template. `subject` and `body` are nullable text (a template
 * may be created as a stub before its content is filled in). `name` is NOT
 * NULL.
 */
export interface Template {
  id: string;
  orgId: string;
  name: string;
  subject: string | null;
  body: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * public.sequences row.
 *
 * A named outreach cadence; its ordered steps live in `sequence_steps`. `name`
 * is NOT NULL.
 */
export interface Sequence {
  id: string;
  orgId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * public.sequence_steps row.
 *
 * One ordered step of a `Sequence`. `stepOrder` (NOT NULL, unique per
 * sequence) is the 1-based position; `dayOffset` (NOT NULL) is days from
 * sequence start. `channel` is NOT NULL. `templateId` is nullable — a step may
 * have no template, and the FK is `on delete set null`. There is no
 * `updatedAt`: rows are replaced rather than mutated in place.
 */
export interface SequenceStep {
  id: string;
  orgId: string;
  sequenceId: string;
  stepOrder: number;
  dayOffset: number;
  channel: TouchpointChannel;
  templateId: string | null;
  createdAt: string;
}

/**
 * public.organizations.settings (jsonb, NOT NULL default '{}').
 *
 * A loose record of known, all-optional org-level settings. Every field is
 * optional because the stored object may be `{}` or carry only a subset; under
 * exactOptionalPropertyTypes an absent key means "unset", so readers must
 * tolerate `undefined`. Unknown keys are permitted via the index signature so
 * the type does not have to enumerate every future setting.
 */
export interface OrgSettings {
  dailyGoal?: number;
  weeklyCallsGoal?: number;
  weeklyEmailsGoal?: number;
  rhythmGreen?: number;
  rhythmAmber?: number;
  rhythmRed?: number;
  rhythmNone?: number;
  signature?: string;
  defaultCountryCode?: string;
  seqSkipWeekends?: boolean;
  [key: string]: unknown;
}
