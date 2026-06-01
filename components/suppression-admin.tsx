'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addSuppression, removeSuppression } from '@/lib/actions/email';
import { Button, Card, EmptyState, Field, Icon, Pill } from '@/components/ui';
import { suppressReasonPill } from '@/lib/ui/status';

export interface SuppressionRow {
  id: string;
  email: string;
  reason: string;
  createdAt: string;
}

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <Card title="Add a manual suppression">
        <div className="row gap-5 center" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ minWidth: 280 }}>
            <Field label="Email address to suppress" htmlFor="suppress-email">
              <input
                id="suppress-email"
                type="email"
                className="input"
                aria-label="Email address to suppress"
                placeholder="address@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
          </div>
          <Button
            variant="primary"
            icon="suppress"
            disabled={busy || email.trim() === ''}
            onClick={() =>
              run(async () => {
                await addSuppression({ email, reason: 'manual' });
                setEmail('');
              })
            }
          >
            Add manual suppression
          </Button>
        </div>
      </Card>

      {error ? (
        <div className="banner banner--warning" role="alert">
          <span className="banner__icon">
            <Icon name="alertCircle" size={16} />
          </span>
          <span>{error}</span>
        </div>
      ) : null}

      <Card title={`Suppressed addresses (${rows.length})`} bodyStyle={{ padding: 0 }}>
        {rows.length === 0 ? (
          <EmptyState
            icon="suppress"
            title="No suppressions"
            desc="Replies and bounces add addresses here automatically. You can also add one manually above."
          />
        ) : (
          <div className="tbl-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Address</th>
                  <th scope="col">Reason</th>
                  <th scope="col" style={{ width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="mono sm">{r.email}</td>
                    <td>
                      <Pill spec={suppressReasonPill(r.reason)} withDot={false} />
                    </td>
                    <td style={{ width: 60, textAlign: 'right' }}>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="trash"
                        disabled={busy}
                        aria-label={`Remove ${r.email}`}
                        title="Remove"
                        onClick={() => run(() => removeSuppression(r.id))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
