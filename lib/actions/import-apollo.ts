'use server';

/**
 * Phase 2 write-layer Server Action: Apollo / generic CSV contact import.
 *
 * Parses a CSV (header row + data rows) with a minimal, dependency-free parser
 * that tolerates quoted fields, embedded commas/newlines, and doubled-quote
 * escapes. Recognised Apollo/generic columns map to dedicated contact columns;
 * every unrecognised column is routed into the `metadata` jsonb map.
 *
 * Dedupe is per the confirmed product decision: for each row with an email we
 * look up an existing contact by `org_id` + `lower(email)`. If found we UPDATE
 * it (merging metadata into the existing map); otherwise we INSERT (org_id from
 * getCurrentOrgId, campaign_id from the input). Rows with no email are skipped
 * and counted. We deliberately do NOT use `INSERT ... ON CONFLICT` against the
 * partial `contacts_org_lower_email_uidx` index — a partial index cannot be
 * inferred as a conflict arbiter — so this is an explicit select-then-write.
 */
import { revalidatePath } from 'next/cache';
import { and, eq, ilike } from 'drizzle-orm';
import { z } from 'zod';
import { withRls } from '@/lib/db/rls';
import { requireSession, rlsCtxFromSession } from '@/lib/auth/session';
import { contacts as contactsTable } from '@/lib/db/schema';
import { escapeLike } from '@/lib/db/like';

// --- Inputs -------------------------------------------------------------------

const importApolloCsvSchema = z.object({
  campaignId: z.string().uuid(),
  csvText: z.string().min(1, 'csvText is required'),
});

export type ImportApolloCsvInput = z.input<typeof importApolloCsvSchema>;

export interface ImportApolloSummary {
  inserted: number;
  updated: number;
  skipped: number;
}

// --- Column mapping -----------------------------------------------------------

/**
 * Recognised header -> contact column. Keys are normalised (lower-cased,
 * trimmed, non-alphanumerics collapsed) so "First Name", "first_name" and
 * "FIRST NAME" all match. Apollo's common export headers plus generic aliases
 * are covered; anything not here falls through to `metadata`.
 */
const COLUMN_BY_HEADER: Record<string, string> = {
  firstname: 'first_name',
  first: 'first_name',
  lastname: 'last_name',
  last: 'last_name',
  email: 'email',
  emailaddress: 'email',
  company: 'company',
  companyname: 'company',
  organization: 'company',
  account: 'company',
  phone: 'phone',
  phonenumber: 'phone',
  workphone: 'phone',
  mobile: 'mobile',
  mobilephone: 'mobile',
  cell: 'mobile',
  title: 'job_title',
  jobtitle: 'job_title',
  seniority: 'seniority',
  country: 'country',
  linkedin: 'linkedin',
  linkedinurl: 'linkedin',
  personlinkedinurl: 'linkedin',
};

/** Contact columns that accept a recognised CSV value. */
const RECOGNISED_COLUMNS = new Set(Object.values(COLUMN_BY_HEADER));

/**
 * Map the recognised DB column names (the values in COLUMN_BY_HEADER, e.g.
 * `first_name`) to the corresponding Drizzle schema field on `contacts`. Used
 * to translate the `mapped` payload (keyed by DB column name) into the
 * camelCased keys Drizzle's insert/update expect, without losing the
 * "recognised column" guard that drives which values are written.
 */
const DRIZZLE_FIELD_BY_COLUMN = {
  first_name: 'firstName',
  last_name: 'lastName',
  email: 'email',
  company: 'company',
  phone: 'phone',
  mobile: 'mobile',
  job_title: 'jobTitle',
  seniority: 'seniority',
  country: 'country',
  linkedin: 'linkedin',
} as const satisfies Record<string, keyof typeof contactsTable.$inferInsert>;

function normaliseHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

// --- CSV parsing --------------------------------------------------------------

/**
 * Parse CSV into rows of string cells. Handles:
 *  - quoted fields ("a,b") with embedded commas and newlines,
 *  - doubled-quote escapes ("" -> "),
 *  - CRLF or LF line endings.
 * Returns one array per record; trailing blank line produces no record.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const pushField = (): void => {
    row.push(field);
    field = '';
  };
  const pushRow = (): void => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text[i] as string;

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      pushField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      // CR (or CRLF) is one row break: break here and consume the paired LF too
      // when present, so CRLF does not produce a spurious empty second row.
      if (text[i + 1] === '\n') {
        pushRow();
        i += 2;
        continue;
      }
      pushRow();
      i += 1;
      continue;
    }
    if (ch === '\n') {
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // Flush the final field/row unless the input ended on a clean row break with
  // no trailing content.
  if (field !== '' || row.length > 0) {
    pushRow();
  }

  return rows;
}

/** True if a parsed row is entirely empty (e.g. a stray blank line). */
function isBlankRow(cells: readonly string[]): boolean {
  return cells.every((c) => c.trim() === '');
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// --- Action -------------------------------------------------------------------

export async function importApolloCsv(input: ImportApolloCsvInput): Promise<ImportApolloSummary> {
  const { campaignId, csvText } = importApolloCsvSchema.parse(input);

  const rows = parseCsv(csvText).filter((r) => !isBlankRow(r));
  if (rows.length < 2) {
    throw new Error('importApolloCsv: CSV must contain a header row and at least one data row');
  }

  const header = rows[0] as string[];
  const headerKeys = header.map(normaliseHeader);

  const ctx = rlsCtxFromSession(await requireSession());
  const orgId = ctx.orgId;

  // Run the whole import in one RLS-scoped transaction: the session GUCs set by
  // withRls scope every lookup/insert/update to the caller's org, and RLS's
  // WITH CHECK enforces org_id on insert. We still set org_id explicitly so the
  // NOT NULL column is satisfied and the WITH-CHECK predicate passes.
  const { inserted, updated, skipped } = await withRls(ctx, async (tx) => {
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (let r = 1; r < rows.length; r += 1) {
      const cells = rows[r] as string[];

      // Build the recognised-column values + the metadata map for this row.
      // `metadata` is keyed by raw CSV headers (user-controlled), so use a
      // null-prototype map: a header literally named `__proto__`/`constructor`
      // is then stored as ordinary data instead of mutating Object.prototype.
      const mapped: Record<string, string | null> = {};
      const metadata: Record<string, unknown> = Object.create(null) as Record<string, unknown>;

      for (let c = 0; c < headerKeys.length; c += 1) {
        const key = headerKeys[c] as string;
        const raw = c < cells.length ? (cells[c] as string) : '';
        const column = COLUMN_BY_HEADER[key];

        if (column !== undefined && RECOGNISED_COLUMNS.has(column)) {
          // First recognised header wins for a given column; do not overwrite a
          // populated value with a later blank duplicate column.
          const value = blankToNull(raw);
          if (mapped[column] === undefined || (mapped[column] === null && value !== null)) {
            mapped[column] = value;
          }
          continue;
        }

        // Unrecognised column -> metadata, keyed by the ORIGINAL header text.
        const originalHeader = (header[c] as string).trim();
        const value = blankToNull(raw);
        if (originalHeader !== '' && value !== null) {
          metadata[originalHeader] = value;
        }
      }

      const email = mapped['email'] ?? null;
      if (email === null) {
        skipped += 1;
        continue;
      }

      // Dedupe on (org_id, lower(email)) via explicit lookup. LIKE
      // metacharacters are escaped so `ilike` behaves as case-insensitive
      // equality, never a wildcard match against another contact. RLS already
      // scopes the query to the caller's org via the session GUCs.
      const existingRows = await tx
        .select({ id: contactsTable.id, metadata: contactsTable.metadata })
        .from(contactsTable)
        .where(
          and(
            eq(contactsTable.orgId, orgId),
            ilike(contactsTable.email, escapeLike(email)),
          ),
        )
        .limit(1);

      const existing = existingRows[0];

      if (existing) {
        // UPDATE: merge metadata into the existing map, overwrite recognised
        // columns with the non-null values present in this row.
        const mergedMetadata: Record<string, unknown> = {
          ...(existing.metadata ?? {}),
          ...metadata,
        };

        const patch: Record<string, unknown> = { metadata: mergedMetadata };
        for (const column of RECOGNISED_COLUMNS) {
          const value = mapped[column];
          if (value !== undefined && value !== null) {
            patch[DRIZZLE_FIELD_BY_COLUMN[column as keyof typeof DRIZZLE_FIELD_BY_COLUMN]] = value;
          }
        }

        await tx
          .update(contactsTable)
          .set(patch)
          .where(eq(contactsTable.id, existing.id));
        updated += 1;
        continue;
      }

      // INSERT: org_id from the caller (RLS WITH CHECK), campaign_id from input.
      const row: Record<string, unknown> = {
        orgId,
        campaignId,
        email,
        metadata,
      };
      for (const column of RECOGNISED_COLUMNS) {
        if (column === 'email') {
          continue;
        }
        const value = mapped[column];
        if (value !== undefined) {
          row[DRIZZLE_FIELD_BY_COLUMN[column as keyof typeof DRIZZLE_FIELD_BY_COLUMN]] = value;
        }
      }

      await tx.insert(contactsTable).values(row as typeof contactsTable.$inferInsert);
      inserted += 1;
    }

    return { inserted, updated, skipped };
  });

  revalidatePath('/contacts');
  revalidatePath('/pipeline');
  revalidatePath('/today');

  return { inserted, updated, skipped };
}
