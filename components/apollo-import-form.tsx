'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Campaign } from '@/lib/types/domain';
import { importApolloCsv } from '@/lib/actions/import-apollo';
import type { ImportApolloSummary } from '@/lib/actions/import-apollo';

/**
 * Client form for the Apollo / generic CSV import flow.
 *
 * Lets the user choose a target campaign, then supply CSV either by pasting it
 * into a textarea or by selecting a `.csv` file (read client-side via the File
 * API and dropped into the same textarea, so the two inputs share one source of
 * truth). On submit it calls the `importApolloCsv` Server Action directly with
 * the typed `{ campaignId, csvText }` input and renders the returned
 * `{ inserted, updated, skipped }` summary.
 *
 * Styling mirrors the inline-style approach used elsewhere (Tailwind is not
 * wired yet — see app/today/page.tsx and components/contact-form.tsx).
 */

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8125rem',
  fontWeight: 600,
  color: '#374151',
  marginBottom: '0.35rem',
};

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.625rem',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  fontSize: '0.9375rem',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

const fieldGroupStyle: React.CSSProperties = {
  marginBottom: '1.1rem',
};

const submitStyle: React.CSSProperties = {
  padding: '0.55rem 1.25rem',
  background: '#111',
  color: '#fff',
  border: '1px solid #111',
  borderRadius: 4,
  fontSize: '0.9375rem',
  fontWeight: 600,
  cursor: 'pointer',
};

const hintStyle: React.CSSProperties = {
  margin: '0.35rem 0 0',
  fontSize: '0.8125rem',
  color: '#888',
};

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
    <form onSubmit={onSubmit} style={{ fontFamily: 'system-ui, sans-serif' }}>
      <div style={fieldGroupStyle}>
        <label htmlFor="campaignId" style={labelStyle}>
          Target campaign *
        </label>
        <select
          id="campaignId"
          name="campaignId"
          required
          value={campaignId}
          onChange={(e) => setCampaignId(e.target.value)}
          style={fieldStyle}
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
        <p style={hintStyle}>New contacts are added to this campaign.</p>
      </div>

      <div style={fieldGroupStyle}>
        <label htmlFor="csvFile" style={labelStyle}>
          Upload a .csv file
        </label>
        <input
          id="csvFile"
          name="csvFile"
          type="file"
          accept=".csv,text/csv"
          onChange={onFileChange}
          style={fieldStyle}
        />
        {fileName ? (
          <p style={hintStyle}>
            Loaded <strong>{fileName}</strong> into the box below — review or edit
            it before importing.
          </p>
        ) : (
          <p style={hintStyle}>The file is read in your browser and shown below.</p>
        )}
      </div>

      <div style={fieldGroupStyle}>
        <label htmlFor="csvText" style={labelStyle}>
          …or paste CSV text
        </label>
        <textarea
          id="csvText"
          name="csvText"
          rows={12}
          value={csvText}
          onChange={(e) => {
            setCsvText(e.target.value);
            setError(null);
            setSummary(null);
          }}
          placeholder="First Name,Last Name,Email,Company,Title,…"
          style={{
            ...fieldStyle,
            resize: 'vertical',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: '0.8125rem',
          }}
        />
        <p style={hintStyle}>
          The first row must be the header. Rows without an email are skipped;
          existing contacts (matched on email within this org) are updated.
        </p>
      </div>

      {error ? (
        <div
          role="alert"
          style={{
            marginBottom: '1.1rem',
            padding: '0.75rem 1rem',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 4,
            color: '#b91c1c',
            fontSize: '0.9rem',
          }}
        >
          {error}
        </div>
      ) : null}

      {summary ? (
        <div
          role="status"
          style={{
            marginBottom: '1.1rem',
            padding: '1rem 1.25rem',
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: 6,
            color: '#166534',
            fontSize: '0.9375rem',
          }}
        >
          <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>Import complete.</p>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', lineHeight: 1.7 }}>
            <li>
              <strong>{summary.inserted}</strong> inserted
            </li>
            <li>
              <strong>{summary.updated}</strong> updated
            </li>
            <li>
              <strong>{summary.skipped}</strong> skipped (no email)
            </li>
          </ul>
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
        <button type="submit" disabled={pending} style={submitStyle}>
          {pending ? 'Importing…' : 'Import contacts'}
        </button>
        <Link
          href="/contacts"
          style={{
            padding: '0.55rem 1.25rem',
            background: '#fff',
            color: '#374151',
            border: '1px solid #d1d5db',
            borderRadius: 4,
            fontSize: '0.9375rem',
            textDecoration: 'none',
            display: 'inline-block',
          }}
        >
          {summary ? 'Done' : 'Cancel'}
        </Link>
      </div>
    </form>
  );
}
