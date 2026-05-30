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
  PipelineStatusCount,
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
  created_at: string;
  updated_at: string;
}

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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
    .select(
      'id, org_id, campaign_id, first_name, last_name, email, company, phone, mobile, job_title, seniority, country, linkedin, status, sequence_day, follow_up, notes, legacy_id, created_at, updated_at',
    )
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
 *
 * Counts come from the database (one `head: true, count: 'exact'` request per
 * status) rather than from fetching every row and aggregating in memory — the
 * latter silently undercounts past PostgREST's `max_rows` cap (1000, see
 * supabase/config.toml). RLS scopes each count to the caller's org.
 */
export async function getPipelineSummary(): Promise<PipelineStatusCount[]> {
  const supabase = await createClient();

  return Promise.all(
    CONTACT_STATUSES.map(async (status): Promise<PipelineStatusCount> => {
      const { count, error } = await supabase
        .from('contacts')
        .select('*', { head: true, count: 'exact' })
        .eq('status', status);

      if (error) {
        throw new Error(
          `getPipelineSummary: failed to count contacts with status "${status}": ${error.message}`,
        );
      }

      return { status, count: count ?? 0 };
    }),
  );
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
