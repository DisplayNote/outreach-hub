'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Campaign } from '@/lib/types/domain';
import { importApolloCsv } from '@/lib/actions/import-apollo';
import type { ImportApolloSummary } from '@/lib/actions/import-apollo';
import { Button, Field, Icon } from '@/components/ui';

/**
 * Client form for the Apollo / generic CSV import flow.
 *
 * Lets the user choose a target campaign, then supply CSV either by pasting it
 * into a textarea or by selecting a `.csv` file (read client-side via the File
 * API and dropped into the same textarea, so the two inputs share one source of
 * truth). On submit it calls the `importApolloCsv` Server Action directly with
 * the typed `{ campaignId, csvText }` input and renders the returned
 * `{ inserted, updated, skipped }` summary.
 */

export interface ApolloImportFormProps {
  /** Campaigns available as the import target (RLS-scoped to the org). */
  campaigns: readonly Campaign[];
}

export default function ApolloImportForm({ campaigns }: ApolloImportFormProps) {
  const [campaignId, setCampaignId] = useState<string>('');
  const [csvText, setCsvText] = useState<string>('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportApolloSummary | null>(null);

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setError(null);
    setSummary(null);
    try {
      const text = await file.text();
      setCsvText(text);
      setFileName(file.name);
    } catch {
      setError('Could not read that file. Try pasting the CSV text instead.');
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSummary(null);

    if (campaignId === '') {
      setError('Pick a target campaign first.');
      return;
    }
    if (csvText.trim() === '') {
      setError('Paste CSV text or choose a .csv file to import.');
      return;
    }

    setPending(true);
    try {
      const result = await importApolloCsv({ campaignId, csvText });
      setSummary(result);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Import failed.';
      setError(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <Field
          label="Target campaign *"
          htmlFor="campaignId"
          hint="New contacts are added to this campaign."
        >
          <div className="select-wrap">
            <select
              id="campaignId"
              name="campaignId"
              required
              className="select"
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
            >
              <option value="" disabled>
                Select a campaign…
              </option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
            <span className="select-chevron">
              <Icon name="chevronDown" size={15} />
            </span>
          </div>
        </Field>
      </div>

      <div style={{ marginBottom: 'var(--space-6)' }}>
        <Field
          label="Upload a .csv file"
          htmlFor="csvFile"
          hint={
            fileName
              ? `Loaded ${fileName} into the box below — review or edit it before importing.`
              : 'The file is read in your browser and shown below.'
          }
        >
          <input
            id="csvFile"
            name="csvFile"
            type="file"
            accept=".csv,text/csv"
            className="input"
            onChange={onFileChange}
          />
        </Field>
      </div>

      <div style={{ marginBottom: 'var(--space-6)' }}>
        <Field
          label="…or paste CSV text"
          htmlFor="csvText"
          hint="The first row must be the header. Rows without an email are skipped; existing contacts (matched on email within this org) are updated."
        >
          <textarea
            id="csvText"
            name="csvText"
            rows={12}
            className="input"
            value={csvText}
            onChange={(e) => {
              setCsvText(e.target.value);
              setError(null);
              setSummary(null);
            }}
            placeholder="First Name,Last Name,Email,Company,Title,…"
            style={{
              resize: 'vertical',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--fs-sm)',
            }}
          />
        </Field>
      </div>

      {error ? (
        <div role="alert" className="banner banner--warning" style={{ marginBottom: 'var(--space-6)' }}>
          <span className="banner__icon">
            <Icon name="alertCircle" size={16} />
          </span>
          <span>{error}</span>
        </div>
      ) : null}

      {summary ? (
        <div role="status" className="banner banner--success" style={{ marginBottom: 'var(--space-6)' }}>
          <span className="banner__icon">
            <Icon name="checkCircle" size={16} />
          </span>
          <span>
            Import complete. <strong>{summary.inserted}</strong> inserted,{' '}
            <strong>{summary.updated}</strong> updated, <strong>{summary.skipped}</strong> skipped
            (no email).
          </span>
        </div>
      ) : null}

      <div className="row gap-4" style={{ marginTop: 'var(--space-5)' }}>
        <Button type="submit" variant="primary" icon="userPlus" disabled={pending} loading={pending}>
          {pending ? 'Importing…' : 'Import contacts'}
        </Button>
        <Link href="/contacts" className="btn btn--ghost">
          {summary ? 'Done' : 'Cancel'}
        </Link>
      </div>
    </form>
  );
}
