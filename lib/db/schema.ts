/**
 * Drizzle table definitions mirroring the migrated Postgres schema
 * (supabase/migrations/*) column-for-column: names, types, nullability and
 * defaults. This is the single source of truth the data layer queries against
 * after the supabase-js → Drizzle conversion.
 *
 * Conventions, chosen so a Drizzle row deserialises to the existing domain
 * types in lib/types/domain.ts WITHOUT a casting shim:
 *   - timestamptz columns use { withTimezone: true, mode: 'string' } so reads
 *     return the ISO strings the domain types (createdAt, updatedAt, …) expect,
 *     matching what PostgREST returned before.
 *   - date columns (contacts.follow_up) use { mode: 'string' } → 'YYYY-MM-DD'.
 *   - bigint legacy_id columns use { mode: 'number' } so they deserialise to the
 *     `number | null` the domain types declare (node-postgres returns bigint as
 *     a string by default).
 *   - jsonb columns are typed with $type<…>() to carry the domain shape
 *     (OrgSettings / metadata maps) through to callers.
 *   - enums are pgEnum referencing the EXACT Postgres enum type names so Drizzle
 *     emits the right type and the values line up with the domain unions.
 *
 * RLS stays the multi-tenant boundary: there are NO app-layer org filters baked
 * into these defs. Every query runs inside withRls / withServiceRls, which set
 * the app.org_id / app.user_id GUCs the policies read.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  ContactStatus,
  OrgSettings,
  TouchpointChannel,
} from '@/lib/types/domain';

/** timestamptz → ISO string (matches the domain `string` timestamp fields). */
const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });
/** timestamptz with `default now()` — optional on insert, like the DB column. */
const tstzNow = (name: string) => tstz(name).default(sql`now()`);

// --- Enums -------------------------------------------------------------------

/** public.contact_status — members verbatim, lower-case. */
export const contactStatus = pgEnum('contact_status', [
  'none',
  'amber',
  'red',
  'green',
  'meeting',
  'notinterested',
  'bounced',
]);

/** public.touchpoint_channel — members verbatim, lower-case. */
export const touchpointChannel = pgEnum('touchpoint_channel', [
  'email',
  'phone',
  'linkedin',
  'other',
]);

/** public.call_attempt_state — AMD dialler lifecycle states (Phase 4). */
export const callAttemptState = pgEnum('call_attempt_state', [
  'queued',
  'dialing',
  'ringing',
  'answered',
  'machine',
  'bridged',
  'ended',
  'failed',
]);

// --- Tables ------------------------------------------------------------------

/** public.organizations — tenant root; settings is the account-tier jsonb. */
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: tstzNow('created_at').notNull(),
  settings: jsonb('settings').$type<OrgSettings>().notNull().default({}),
});

/** public.users — app user; org_id pins tenancy, role gates admin. */
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  email: text('email').notNull(),
  fullName: text('full_name'),
  role: text('role').notNull().default('member'),
  createdAt: tstzNow('created_at').notNull(),
  updatedAt: tstzNow('updated_at').notNull(),
});

/** public.campaigns — sequence_id links the cadence the email runner walks. */
export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  name: text('name').notNull(),
  sequence: text('sequence'),
  legacyId: bigint('legacy_id', { mode: 'number' }),
  createdAt: tstzNow('created_at').notNull(),
  updatedAt: tstzNow('updated_at').notNull(),
  sequenceId: uuid('sequence_id'),
});

/** public.contacts — the outreach record; metadata is the Apollo extension map. */
export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  campaignId: uuid('campaign_id').notNull(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  email: text('email'),
  company: text('company'),
  phone: text('phone'),
  mobile: text('mobile'),
  jobTitle: text('job_title'),
  seniority: text('seniority'),
  country: text('country'),
  linkedin: text('linkedin'),
  status: contactStatus('status').$type<ContactStatus>().notNull().default('none'),
  sequenceDay: integer('sequence_day'),
  followUp: date('follow_up', { mode: 'string' }),
  notes: text('notes'),
  legacyId: bigint('legacy_id', { mode: 'number' }),
  createdAt: tstzNow('created_at').notNull(),
  updatedAt: tstzNow('updated_at').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  lastEmailedAt: tstz('last_emailed_at'),
});

/** public.touchpoints — append-only contact interaction log (no updated_at). */
export const touchpoints = pgTable('touchpoints', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  contactId: uuid('contact_id').notNull(),
  channel: touchpointChannel('channel').$type<TouchpointChannel>().notNull(),
  note: text('note'),
  occurredAt: tstzNow('occurred_at').notNull(),
  legacyId: text('legacy_id'),
  createdAt: tstzNow('created_at').notNull(),
});

/** public.templates — reusable email template; (id, org_id) is a composite uk. */
export const templates = pgTable('templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  name: text('name').notNull(),
  subject: text('subject'),
  body: text('body'),
  createdAt: tstzNow('created_at').notNull(),
  updatedAt: tstzNow('updated_at').notNull(),
});

/** public.sequences — named cadence; ordered steps live in sequence_steps. */
export const sequences = pgTable('sequences', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  name: text('name').notNull(),
  createdAt: tstzNow('created_at').notNull(),
  updatedAt: tstzNow('updated_at').notNull(),
});

/** public.sequence_steps — one ordered step (no updated_at). */
export const sequenceSteps = pgTable('sequence_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  sequenceId: uuid('sequence_id').notNull(),
  stepOrder: integer('step_order').notNull(),
  dayOffset: integer('day_offset').notNull(),
  channel: touchpointChannel('channel').$type<TouchpointChannel>().notNull(),
  templateId: uuid('template_id'),
  createdAt: tstzNow('created_at').notNull(),
});

/** public.call_runs — one AMD dialler batch (Phase 4). */
export const callRuns = pgTable('call_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  mode: text('mode').notNull().default('amd'),
  status: text('status').notNull().default('active'),
  createdBy: uuid('created_by').notNull(),
  createdAt: tstzNow('created_at').notNull(),
  updatedAt: tstzNow('updated_at').notNull(),
});

/** public.call_attempts — the live per-contact call state row (Phase 4). */
export const callAttempts = pgTable('call_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  runId: uuid('run_id').notNull(),
  contactId: uuid('contact_id').notNull(),
  toNumber: text('to_number').notNull(),
  fromNumber: text('from_number'),
  provider: text('provider').notNull().default('telnyx'),
  callControlId: text('call_control_id'),
  state: callAttemptState('state').notNull().default('queued'),
  amdResult: text('amd_result'),
  disposition: text('disposition'),
  hangupCause: text('hangup_cause'),
  error: text('error'),
  actuatedAt: tstz('actuated_at'),
  startedAt: tstz('started_at'),
  endedAt: tstz('ended_at'),
  createdAt: tstzNow('created_at').notNull(),
  updatedAt: tstzNow('updated_at').notNull(),
});

/** public.call_events — append-only per-attempt event log (Phase 4). */
export const callEvents = pgTable('call_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  attemptId: uuid('attempt_id').notNull(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  occurredAt: tstzNow('occurred_at').notNull(),
  createdAt: tstzNow('created_at').notNull(),
});

/** public.email_events — append-only per-message audit + send-dedup (Phase 5). */
export const emailEvents = pgTable('email_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  contactId: uuid('contact_id').notNull(),
  campaignId: uuid('campaign_id'),
  type: text('type').notNull(),
  provider: text('provider').notNull(),
  recipient: text('recipient'),
  messageId: text('message_id'),
  conversationId: text('conversation_id'),
  inReplyTo: text('in_reply_to'),
  subject: text('subject'),
  sequenceDay: integer('sequence_day'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  occurredAt: tstz('occurred_at').notNull(),
  createdAt: tstz('created_at').notNull(),
});

/** public.suppressions — address-level do-not-send (Phase 5). email is normalised. */
export const suppressions = pgTable('suppressions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  email: text('email').notNull(),
  reason: text('reason').notNull(),
  contactId: uuid('contact_id'),
  createdAt: tstz('created_at').notNull(),
});

/** public.user_settings — per-user settings blob, self-scoped by RLS. */
export const userSettings = pgTable('user_settings', {
  userId: uuid('user_id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull(),
  createdAt: tstz('created_at').notNull(),
  updatedAt: tstz('updated_at').notNull(),
});

/** public.user_graph_tokens — server-only delegated Graph tokens, RLS self-scoped. */
export const userGraphTokens = pgTable('user_graph_tokens', {
  userId: uuid('user_id').primaryKey(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  expiresAt: tstz('expires_at'),
  updatedAt: tstz('updated_at').notNull(),
});
