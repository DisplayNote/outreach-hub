'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addSuppression, removeSuppression } from '@/lib/actions/email';

export interface SuppressionRow {
  id: string;
  email: string;
  reason: string;
  createdAt: string;
}

const btn: React.CSSProperties = {
  padding: '0.4rem 0.8rem',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
  fontSize: '0.85rem',
  cursor: 'pointer',
};

export default function SuppressionAdmin({ rows }: { rows: readonly SuppressionRow[] }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Action failed');
      } finally {
        setBusy(false);
      }
    },
    [router],
  );

  return (
    <div>
      <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
        <input
          type="email"
          placeholder="address@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ ...btn, minWidth: 260, cursor: 'text' }}
        />
        <button
          type="button"
          disabled={busy || email.trim() === ''}
          onClick={() => run(async () => { await addSuppression({ email, reason: 'manual' }); setEmail(''); })}
          style={{ ...btn, background: '#111', color: '#fff', borderColor: '#111' }}
        >
          Add manual suppression
        </button>
      </div>
      {error ? <p style={{ color: '#b91c1c', fontSize: '0.85rem' }}>{error}</p> : null}

      <ul style={{ listStyle: 'none', padding: 0, marginTop: '1.5rem' }}>
        {rows.length === 0 ? (
          <li style={{ color: '#6b7280', fontSize: '0.9rem' }}>No suppressions.</li>
        ) : (
          rows.map((r) => (
            <li
              key={r.id}
              style={{ padding: '0.6rem 0', borderTop: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <span>
                <strong>{r.email}</strong>{' '}
                <span style={{ color: '#6b7280', fontSize: '0.85rem' }}>· {r.reason}</span>
              </span>
              <button type="button" disabled={busy} onClick={() => run(() => removeSuppression(r.id))} style={btn}>
                Remove
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
