/**
 * Pure snake_case-row → `Contact` mapper, kept in its own module so consumers
 * that only need the mapper (e.g. the email store and its unit tests) don't pull
 * in the query layer's auth/session/next-auth chain. `lib/db/queries.ts`
 * re-exports both for backwards compatibility.
 */
import type { Contact, ContactStatus } from '@/lib/types/domain';

/**
 * The contacts row shape as returned by a raw snake_case read (e.g. one
 * lib/email/store.ts performs itself via an RPC). Differs from Drizzle's
 * inferred select in that `metadata` is typed as nullable so that projections
 * which omit it are handled defensively by the mapper. This explicit type
 * backs the `toContact` mapper.
 */
export interface ContactRow {
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
  last_emailed_at: string | null;
  notes: string | null;
  legacy_id: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/** Map a snake_case contacts row to the camelCase `Contact` domain type. */
export function toContact(row: ContactRow): Contact {
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
    lastEmailedAt: row.last_emailed_at,
    notes: row.notes,
    legacyId: row.legacy_id,
    // `metadata` is NOT NULL default '{}' in Postgres, but coalesce defensively
    // in case a projection ever omits it.
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
