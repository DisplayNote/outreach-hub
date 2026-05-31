'use client';

/**
 * Email Queue controller (PHASE_5_SPEC §10). Drives the manual triggers — run
 * the sender (with a dry-run preview), scan the inbox, link a campaign to a
 * sequence + enrol its contacts, and (dev-only, gated) simulate a reply/bounce
 * so the full reply→stop / bounce→suppress loop is exercisable without a real
 * mailbox. Re-fetches the server component after a mutation via router.refresh().
 */
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  runSenderNow,
  scanInboxNow,
  setCampaignSequence,
  enrolInSequence,
  simulateInbound,
} from '@/lib/actions/email';

export interface QueueItem {
  contactId: string;
  name: string;
  email: string;
  sequenceDay: number;
  subject: string;
}

export interface EmailRunnerProps {
  queue: readonly QueueItem[];
  emailMockEnabled: boolean;
  campaigns: ReadonlyArray<{ id: string; name: string }>;
  sequences: ReadonlyArray<{ id: string; name: string }>;
}

const card: React.CSSProperties = {
  marginTop: '1.5rem',
  padding: '1.25rem',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  background: '#fff',
};
const primaryBtn: React.CSSProperties = {
  padding: '0.55rem 1.2rem',
  background: '#111',
  color: '#fff',
  border: '1px solid #111',
  borderRadius: 6,
  fontSize: '0.9rem',
  fontWeight: 600,
  cursor: 'pointer',
};
const secondaryBtn: React.CSSProperties = {
  padding: '0.4rem 0.8rem',
  background: '#fff',
  color: '#374151',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: '0.85rem',
  cursor: 'pointer',
};

export default function EmailRunner({ queue, emailMockEnabled, campaigns, sequences }: EmailRunnerProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(false);
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? '');
  const [sequenceId, setSequenceId] = useState(sequences[0]?.id ?? '');

  const act = useCallback(
    async (label: string, fn: () => Promise<string>) => {
      setBusy(label);
      setError(null);
      setMessage(null);
      try {
        setMessage(await fn());
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Action failed');
      } finally {
        setBusy(null);
      }
    },
    [router],
  );

  const runNow = () =>
    act('run', async () => {
      const r = await runSenderNow({ dryRun });
      return dryRun
        ? `Dry run: ${r.planned.length} would send, ${r.remaining} over the daily cap.`
        : `Sent ${r.sent}, skipped ${r.skipped}, ${r.errors.length} error(s), ${r.remaining} left over the cap.`;
    });

  const scanNow = () =>
    act('scan', async () => {
      const r = await scanInboxNow();
      return `Scan: ${r.replies} repl${r.replies === 1 ? 'y' : 'ies'}, ${r.bounces} bounce(s), ${r.ignored} ignored.`;
    });

  const link = () =>
    act('link', async () => {
      await setCampaignSequence(campaignId, sequenceId);
      return 'Linked campaign to sequence.';
    });

  const enrol = () =>
    act('enrol', async () => {
      const r = await enrolInSequence(campaignId);
      return `Enrolled ${r.enrolled} contact(s).`;
    });

  const simulate = (email: string, kind: 'reply' | 'bounce') =>
    act(`sim-${kind}-${email}`, async () => {
      await simulateInbound({ email, kind });
      return `Simulated a ${kind} from ${email}. Click "Scan inbox now" to process it.`;
    });

  return (
    <div>
      {/* Actions */}
      <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
        <label style={{ fontSize: '0.85rem', color: '#374151', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} /> Dry run
        </label>
        <button type="button" onClick={runNow} disabled={busy !== null} style={primaryBtn}>
          {busy === 'run' ? 'Running…' : 'Run sender now'}
        </button>
        <button type="button" onClick={scanNow} disabled={busy !== null} style={secondaryBtn}>
          {busy === 'scan' ? 'Scanning…' : 'Scan inbox now'}
        </button>
      </div>

      {message ? <p style={{ marginTop: '0.75rem', color: '#166534', fontSize: '0.9rem' }}>{message}</p> : null}
      {error ? <p style={{ marginTop: '0.75rem', color: '#b91c1c', fontSize: '0.9rem' }}>{error}</p> : null}

      {/* Sequence setup */}
      <div style={card}>
        <h2 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Sequence setup</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center' }}>
          <select
            aria-label="Campaign"
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            style={secondaryBtn}
          >
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Sequence"
            value={sequenceId}
            onChange={(e) => setSequenceId(e.target.value)}
            style={secondaryBtn}
          >
            {sequences.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={link} disabled={busy !== null || !campaignId || !sequenceId} style={secondaryBtn}>
            Link
          </button>
          <button type="button" onClick={enrol} disabled={busy !== null || !campaignId} style={secondaryBtn}>
            Enrol campaign contacts
          </button>
        </div>
      </div>

      {/* Due queue */}
      <div style={card}>
        <h2 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Due today ({queue.length})</h2>
        {queue.length === 0 ? (
          <p style={{ color: '#6b7280', fontSize: '0.9rem', margin: 0 }}>
            Nobody is due. Link a campaign to a sequence and enrol its contacts to populate the queue.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {queue.map((q) => (
              <li
                key={q.contactId}
                style={{ padding: '0.6rem 0', borderTop: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between', gap: '1rem' }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{q.name}</div>
                  <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>
                    {q.email} · day {q.sequenceDay} · “{q.subject}”
                  </div>
                </div>
                {emailMockEnabled ? (
                  <div style={{ display: 'flex', gap: '0.4rem', whiteSpace: 'nowrap' }}>
                    <button type="button" onClick={() => simulate(q.email, 'reply')} disabled={busy !== null} style={secondaryBtn}>
                      Sim reply
                    </button>
                    <button type="button" onClick={() => simulate(q.email, 'bounce')} disabled={busy !== null} style={secondaryBtn}>
                      Sim bounce
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
