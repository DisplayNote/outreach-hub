'use client';

/**
 * Email Queue controller (PHASE_5_SPEC §10). Drives the manual triggers — run
 * the sender (with a dry-run preview), scan the inbox, enrol a campaign's
 * contacts, and (dev-only, gated) simulate a reply/bounce so the full
 * reply→stop / bounce→suppress loop is exercisable without a real mailbox.
 * Re-fetches the server component after a mutation via router.refresh().
 *
 * Linking a campaign to a sequence is done on the campaign's own edit page (a
 * validated dropdown), so this controller only reports each campaign's linked
 * sequence here and offers enrolment — the queue's two prerequisites.
 */
import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { runSenderNow, scanInboxNow, enrolInSequence, simulateInbound } from '@/lib/actions/email';
import { Avatar, Badge, Button, Card, EmptyState, Field, Icon } from '@/components/ui';
import { initials } from '@/lib/ui/initials';

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
  /** Org campaigns with the name of their currently linked sequence (or null). */
  campaigns: ReadonlyArray<{ id: string; name: string; sequenceName: string | null }>;
  /** How many contacts are enrolled (follow_up set) across the org. */
  enrolledCount: number;
}

export default function EmailRunner({ queue, emailMockEnabled, campaigns, enrolledCount }: EmailRunnerProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(false);
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? '');
  const [simEmail, setSimEmail] = useState('');
  const linkedCount = campaigns.filter((c) => c.sequenceName).length;

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {/* Run / scan controls */}
      <Card bodyStyle={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-5)', alignItems: 'center' }}>
        <label className="row gap-3 center sm" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} /> Dry run
        </label>
        <Button variant="primary" icon="zap" onClick={runNow} disabled={busy !== null} loading={busy === 'run'}>
          {busy === 'run' ? 'Running…' : 'Run sender now'}
        </Button>
        <Button variant="secondary" icon="refresh" onClick={scanNow} disabled={busy !== null} loading={busy === 'scan'}>
          {busy === 'scan' ? 'Scanning…' : 'Scan inbox now'}
        </Button>
      </Card>

      {message ? (
        <div className="banner banner--success" role="status">
          <span className="banner__icon">
            <Icon name="checkCircle" size={16} />
          </span>
          <span>{message}</span>
        </div>
      ) : null}
      {error ? (
        <div className="banner banner--warning" role="alert">
          <span className="banner__icon">
            <Icon name="alertCircle" size={16} />
          </span>
          <span>{error}</span>
        </div>
      ) : null}

      {/* Enrolment — the queue is built from a campaign's contacts once the
          campaign is linked to a sequence (set on the campaign's edit page) and
          its contacts are enrolled here. */}
      <Card title="Enrolment">
        <p className="sm muted" style={{ marginTop: 0, marginBottom: 'var(--space-5)' }}>
          A campaign&rsquo;s sequence is set on its own <b>edit</b> page. Once linked, enrol its
          contacts here to schedule their first step.
        </p>
        <div className="row gap-5 center" style={{ flexWrap: 'wrap' }}>
          <select
            aria-label="Campaign"
            className="input"
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
          >
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            icon="userPlus"
            onClick={enrol}
            disabled={busy !== null || !campaignId}
            loading={busy === 'enrol'}
          >
            Enrol campaign contacts
          </Button>
        </div>

        {campaigns.length > 0 ? (
          <div className="tbl-wrap" style={{ marginTop: 'var(--space-5)' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Campaign</th>
                  <th scope="col">Linked sequence</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id}>
                    <td className="sm">{c.name}</td>
                    <td className="sm">
                      {c.sequenceName ? (
                        <Badge tone="success">{c.sequenceName}</Badge>
                      ) : (
                        <span className="tert">
                          Not linked —{' '}
                          <Link href={`/campaigns/${c.id}/edit`} className="medb">
                            set it
                          </Link>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      {/* Due queue */}
      <Card title={`Due today (${queue.length})`} bodyStyle={{ padding: 0 }}>
        {queue.length === 0 ? (
          <EmptyState
            icon="inbox"
            title="Nobody is due today"
            desc="A contact appears here once it's enrolled and its next step has come due."
            action={
              <ul
                className="sm muted"
                style={{ textAlign: 'left', margin: 0, paddingLeft: '1.2em' }}
              >
                <li>
                  {linkedCount} of {campaigns.length} campaign(s) linked to a sequence
                </li>
                <li>{enrolledCount} contact(s) enrolled</li>
                <li>Enrolled contacts become due on or after their follow-up date</li>
              </ul>
            }
          />
        ) : (
          <div className="tbl-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col" style={{ width: 40 }}>
                    #
                  </th>
                  <th scope="col">Contact</th>
                  <th scope="col">Rendered subject</th>
                  <th scope="col">Step</th>
                  <th scope="col" className="num">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {queue.map((q, i) => (
                  <tr key={q.contactId}>
                    <td className="num tert">{i + 1}</td>
                    <td>
                      <div className="row gap-5 center">
                        <Avatar initials={initials(q.name, q.email)} size="sm" />
                        <div style={{ minWidth: 0 }}>
                          <div className="medb" style={{ whiteSpace: 'nowrap' }}>
                            {q.name}
                          </div>
                          <div
                            className="cap tert"
                            style={{
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              maxWidth: 200,
                            }}
                          >
                            {q.email}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div
                        className="sm"
                        style={{
                          maxWidth: 320,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {q.subject}
                      </div>
                    </td>
                    <td className="sm muted" style={{ whiteSpace: 'nowrap' }}>
                      Day {q.sequenceDay}
                    </td>
                    <td className="num">
                      <Badge tone="success">Ready</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Dev-only standalone simulator — works after a contact has advanced out
          of the due queue (and so models a reply/bounce arriving AFTER the send,
          which the scanner's send-before-inbound correlation guard requires). */}
      {emailMockEnabled ? (
        <Card>
          {/* Heading lives in the same body block as the controls so the e2e's
              `locator('div', { hasText: 'Simulate inbound (dev)' }).last()`
              still resolves to a node that contains the Sim reply/bounce
              buttons. Rendered as an <h2>, not a nested <div>. */}
          <h2 className="card__title row gap-3 center" style={{ marginTop: 0, marginBottom: 'var(--space-5)' }}>
            <Icon name="flask" size={15} />
            Simulate inbound (dev)
          </h2>
          <div className="row gap-5" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ minWidth: 260 }}>
              <Field label="Contact email to simulate inbound from" htmlFor="sim-email">
                <input
                  id="sim-email"
                  type="email"
                  className="input"
                  aria-label="Contact email to simulate inbound from"
                  placeholder="contact@example.com"
                  value={simEmail}
                  onChange={(e) => setSimEmail(e.target.value)}
                />
              </Field>
            </div>
            <Button
              variant="secondary"
              icon="reply"
              onClick={() => simulate(simEmail.trim(), 'reply')}
              disabled={busy !== null || simEmail.trim() === ''}
            >
              Sim reply
            </Button>
            <Button
              variant="secondary"
              icon="alert"
              onClick={() => simulate(simEmail.trim(), 'bounce')}
              disabled={busy !== null || simEmail.trim() === ''}
            >
              Sim bounce
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
