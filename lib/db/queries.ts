/**
 * Server-side, RLS-relying typed query helpers for the outreach domain.
 *
 * Every helper runs inside `withRls(rlsCtxFromSession(await requireSession()), …)`,
 * which sets the `app.org_id` / `app.user_id` session GUCs the RLS policies read,
 * scoping every query to the caller's org. We therefore never filter by `org_id`
 * here — the database does it for us. Callers must be authenticated (these run
 * from auth-gated server components / route handlers).
 *
 * Drizzle rows deserialise straight to the camelCase domain types
 * (lib/types/domain.ts) thanks to the schema conventions (see lib/db/schema.ts),
 * so the row→domain mappers below are mostly field-rename shims kept for the few
 * embedded-join projections and for the `toContact` / `ContactRow` exports that
 * lib/email/store.ts still imports.
 */
import { and, asc, count, desc, eq, gte, isNotNull, lte } from 'drizzle-orm';
import { withRls } from '@/lib/db/rls';
import { rlsCtxFromSession, requireSession } from '@/lib/auth/session';
import {
  campaigns,
  contacts,
  organizations,
  sequences,
  sequenceSteps,
  templates,
  touchpoints,
  userSettings,
} from '@/lib/db/schema';
import type { DrizzleTx } from '@/lib/db/rls';
import type {
  ActivityItem,
  Campaign,
  Contact,
  ContactStatus,
  OrgSettings,
  PipelineStatusCount,
  ReportMetrics,
  Sequence,
  SequenceStep,
  SequenceWithSteps,
  Template,
  Touchpoint,
  UserSettings,
} from '@/lib/types/domain';
import { CONTACT_STATUSES } from '@/lib/types/domain';

// --- RLS scope helper --------------------------------------------------------

/**
 * Run `fn` in a transaction scoped to the current authenticated session's org
 * (and user) via the RLS GUCs. Every exported read below funnels through this,
 * so the org boundary stays the database's job — there are no app-layer org
 * filters in any query here.
 */
async function withSession<T>(fn: (tx: DrizzleTx) => Promise<T>): Promise<T> {
  return withRls(rlsCtxFromSession(await requireSession()), fn);
}

// --- Raw row shapes (kept for the toContact export consumed elsewhere) -------

// `ContactRow` + `toContact` (the snake_case-row mapper lib/email/store.ts and
// its unit tests import) live in a pure module so those consumers don't pull in
// this module's auth/session/next-auth chain. Re-exported here for the public
// `@/lib/db/queries` path that callers already use.
export { toContact, type ContactRow } from '@/lib/db/contact-row';

// --- Row -> domain mappers ----------------------------------------------------

/** Map a Drizzle contacts row to the camelCase `Contact` domain type. */
function contactFromRow(row: typeof contacts.$inferSelect): Contact {
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
    // `metadata` is NOT NULL default '{}' in Postgres, but coalesce defensively
    // in case a projection ever omits it.
    metadata: row.metadata ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function campaignFromRow(row: typeof campaigns.$inferSelect): Campaign {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    sequence: row.sequence,
    sequenceId: row.sequenceId,
    legacyId: row.legacyId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function touchpointFromRow(row: typeof touchpoints.$inferSelect): Touchpoint {
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

function templateFromRow(row: typeof templates.$inferSelect): Template {
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

function sequenceFromRow(row: typeof sequences.$inferSelect): Sequence {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toSequenceStep(row: typeof sequenceSteps.$inferSelect): SequenceStep {
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

// --- Helpers -----------------------------------------------------------------

/** Today's date as a `YYYY-MM-DD` string, in UTC, for comparison with `follow_up` (a `date`). */
function todayDateString(): string {
  // `follow_up` is a SQL `date` (no time/zone); compare against a plain UTC date.
  return new Date().toISOString().slice(0, 10);
}

/**
 * Contacts whose follow-up is due — `follow_up` is today or earlier (overdue +
 * due today). Contacts with a null `follow_up` are excluded (nothing to chase).
 * Ordered by `follow_up` ascending so the most overdue surface first.
 */
export async function getTodayContacts(): Promise<Contact[]> {
  return withSession(async (tx) => {
    const rows = await tx
      .select()
      .from(contacts)
      .where(and(isNotNull(contacts.followUp), lte(contacts.followUp, todayDateString())))
      .orderBy(asc(contacts.followUp));

    return rows.map(contactFromRow);
  });
}

/**
 * Pipeline rollup: contact counts grouped by status. Returns one bucket per
 * known status (in schema order), including statuses with a zero count, so the
 * UI can render a stable set of columns.
 *
 * A single grouped `count(*)` over the RLS-scoped contacts table replaces the
 * old per-status head-count requests; we then project the known statuses (in
 * schema order), defaulting any absent group to zero. RLS scopes the count to
 * the caller's org.
 */
export async function getPipelineSummary(): Promise<PipelineStatusCount[]> {
  return withSession(async (tx) => {
    const rows = await tx
      .select({ status: contacts.status, count: count() })
      .from(contacts)
      .groupBy(contacts.status);

    const counts = new Map<ContactStatus, number>(rows.map((r) => [r.status, r.count]));

    return CONTACT_STATUSES.map((status): PipelineStatusCount => ({
      status,
      count: counts.get(status) ?? 0,
    }));
  });
}

/** All campaigns visible to the caller's org, ordered by name ascending. */
export async function listCampaigns(): Promise<Campaign[]> {
  return withSession(async (tx) => {
    const rows = await tx.select().from(campaigns).orderBy(asc(campaigns.name));
    return rows.map(campaignFromRow);
  });
}

/**
 * A single contact by id, or `null` if it does not exist / is not visible to
 * the caller's org (RLS returns no row for other orgs, which we surface as a
 * 404 at the page level).
 */
export async function getContact(id: string): Promise<Contact | null> {
  return withSession(async (tx) => {
    const [row] = await tx.select().from(contacts).where(eq(contacts.id, id)).limit(1);
    return row ? contactFromRow(row) : null;
  });
}

/**
 * The full touchpoint history for one contact, most recent first. Ordered by
 * `occurred_at` descending (ties broken by `created_at` descending). RLS scopes
 * this to the caller's org; an unknown / cross-org contact id yields `[]`.
 */
export async function getContactTouchpoints(contactId: string): Promise<Touchpoint[]> {
  return withSession(async (tx) => {
    const rows = await tx
      .select()
      .from(touchpoints)
      .where(eq(touchpoints.contactId, contactId))
      .orderBy(desc(touchpoints.occurredAt), desc(touchpoints.createdAt));

    return rows.map(touchpointFromRow);
  });
}

/**
 * A contact plus the name of its parent campaign, for the contacts list view.
 * The campaign name is resolved via a join; it is non-null because
 * `contacts.campaign_id` is NOT NULL and references `campaigns`.
 */
export interface ContactWithCampaign extends Contact {
  campaignName: string;
}

/**
 * All contacts visible to the caller's org, newest-touched first, each with the
 * name of its parent campaign. RLS scopes the result to the caller's org, so we
 * don't filter by `org_id` here. Ordered by `updated_at` descending.
 */
export async function listContacts(): Promise<ContactWithCampaign[]> {
  return withSession(async (tx) => {
    const rows = await tx
      .select({ contact: contacts, campaignName: campaigns.name })
      .from(contacts)
      .leftJoin(campaigns, eq(campaigns.id, contacts.campaignId))
      .orderBy(desc(contacts.updatedAt));

    return rows.map((row) => ({
      ...contactFromRow(row.contact),
      campaignName: row.campaignName ?? '—',
    }));
  });
}

// --- Phase 2: org settings, templates, sequences -----------------------------

/**
 * The caller's org settings (`organizations.settings`, jsonb). RLS scopes the
 * organizations table to the caller's own org, so the single visible row is the
 * caller's — we take the first row and coalesce a missing row / null column to an
 * empty `{}`. The stored shape is loose; we widen it to `OrgSettings`, whose
 * fields are all optional.
 */
export async function getOrgSettings(): Promise<OrgSettings> {
  return withSession(async (tx) => {
    const [row] = await tx
      .select({ settings: organizations.settings })
      .from(organizations)
      .limit(1);

    return (row?.settings ?? {}) as OrgSettings;
  });
}

/**
 * The caller's org display name (RLS scopes `organizations` to the single
 * visible row). Returns null when no row is visible; callers decide the
 * fallback. Used by the app shell to label the chrome.
 */
export async function getCurrentOrgName(): Promise<string | null> {
  return withSession(async (tx) => {
    const [row] = await tx.select({ name: organizations.name }).from(organizations).limit(1);
    return row?.name ?? null;
  });
}

/**
 * The caller's per-user settings (`user_settings.settings`, jsonb). RLS scopes
 * the table to the caller's own row, so the single visible row (if any) is the
 * caller's — we take the first row and coalesce a missing row / null column to an
 * empty `{}`. The stored shape is loose; we widen it to `UserSettings`, whose
 * fields are all optional, so readers fall back to defaults for unset keys.
 */
export async function getUserSettings(): Promise<UserSettings> {
  return withSession(async (tx) => {
    const [row] = await tx
      .select({ settings: userSettings.settings })
      .from(userSettings)
      .limit(1);

    return (row?.settings ?? {}) as UserSettings;
  });
}

/** All templates visible to the caller's org, ordered by name ascending. */
export async function listTemplates(): Promise<Template[]> {
  return withSession(async (tx) => {
    const rows = await tx.select().from(templates).orderBy(asc(templates.name));
    return rows.map(templateFromRow);
  });
}

/** All sequences visible to the caller's org, ordered by name ascending. */
export async function listSequences(): Promise<Sequence[]> {
  return withSession(async (tx) => {
    const rows = await tx.select().from(sequences).orderBy(asc(sequences.name));
    return rows.map(sequenceFromRow);
  });
}

// --- Reports, activity, and sequence-with-steps ------------------------------

/**
 * A single template by id, or `null` if it does not exist / is not visible to
 * the caller's org (RLS returns no row for other orgs).
 */
export async function getTemplate(id: string): Promise<Template | null> {
  return withSession(async (tx) => {
    const [row] = await tx.select().from(templates).where(eq(templates.id, id)).limit(1);
    return row ? templateFromRow(row) : null;
  });
}

/**
 * A single sequence by id with its ordered steps, or `null` if the sequence
 * does not exist / is not visible to the caller's org. Steps are ordered by
 * `step_order` ascending and may be empty. RLS scopes both reads to the caller's
 * org; we query the steps separately (rather than via a join) to keep the
 * ordering explicit.
 */
export async function getSequenceWithSteps(id: string): Promise<SequenceWithSteps | null> {
  return withSession(async (tx) => {
    const [sequenceRow] = await tx
      .select()
      .from(sequences)
      .where(eq(sequences.id, id))
      .limit(1);

    if (!sequenceRow) {
      return null;
    }

    const stepRows = await tx
      .select()
      .from(sequenceSteps)
      .where(eq(sequenceSteps.sequenceId, id))
      .orderBy(asc(sequenceSteps.stepOrder));

    return {
      ...sequenceFromRow(sequenceRow),
      steps: stepRows.map(toSequenceStep),
    };
  });
}

/** Best-effort display label for a contact: name, else email, else a dash. */
function contactLabelOf(row: {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  company: string | null;
} | null): { name: string; company: string | null } {
  if (!row) return { name: '—', company: null };

  const name = [row.firstName, row.lastName].filter(Boolean).join(' ').trim();
  return {
    name: name !== '' ? name : (row.email ?? '—'),
    company: row.company,
  };
}

/**
 * The most recent touchpoints across the caller's org, newest first, each with
 * its parent contact's name and company resolved via a join. RLS scopes the
 * result to the caller's org. Ordered by `occurred_at` descending (ties broken
 * by `created_at` descending) and capped at `limit` (default 50).
 */
export async function getActivityFeed(limit = 50): Promise<ActivityItem[]> {
  return withSession(async (tx) => {
    const rows = await tx
      .select({
        touchpoint: touchpoints,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
        company: contacts.company,
      })
      .from(touchpoints)
      .leftJoin(contacts, eq(contacts.id, touchpoints.contactId))
      .orderBy(desc(touchpoints.occurredAt), desc(touchpoints.createdAt))
      .limit(limit);

    return rows.map((row): ActivityItem => {
      const { name, company } = contactLabelOf({
        firstName: row.firstName,
        lastName: row.lastName,
        email: row.email,
        company: row.company,
      });
      return {
        ...touchpointFromRow(row.touchpoint),
        contactName: name,
        contactCompany: company,
      };
    });
  });
}

/**
 * Aggregate report metrics for the caller's org: the funnel rollup plus a few
 * simple cadence counts. We pull the bounded, RLS-scoped status/follow-up
 * columns and aggregate in memory (mirroring `getPipelineSummary`'s shape), and
 * count recent touchpoints with a single grouped query.
 */
export async function getReportMetrics(): Promise<ReportMetrics> {
  return withSession(async (tx) => {
    const today = todayDateString();

    // Contact-side aggregation: status buckets + follow-up cadence.
    const contactRows = await tx
      .select({ status: contacts.status, followUp: contacts.followUp })
      .from(contacts);

    const counts = new Map<ContactStatus, number>(
      CONTACT_STATUSES.map((status) => [status, 0]),
    );
    let totalContacts = 0;
    let contactsDueToday = 0;
    let contactsOverdue = 0;

    for (const row of contactRows) {
      totalContacts += 1;
      counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
      if (row.followUp !== null) {
        if (row.followUp === today) {
          contactsDueToday += 1;
        } else if (row.followUp < today) {
          contactsOverdue += 1;
        }
      }
    }

    const byStatus: PipelineStatusCount[] = CONTACT_STATUSES.map((status) => ({
      status,
      count: counts.get(status) ?? 0,
    }));

    // Touchpoint-side aggregation: count of touchpoints in the last 7 days.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [touchpointCountRow] = await tx
      .select({ count: count() })
      .from(touchpoints)
      .where(gte(touchpoints.occurredAt, sevenDaysAgo));

    return {
      totalContacts,
      byStatus,
      meetings: counts.get('meeting') ?? 0,
      bounced: counts.get('bounced') ?? 0,
      touchpointsLast7Days: touchpointCountRow?.count ?? 0,
      contactsDueToday,
      contactsOverdue,
    };
  });
}
