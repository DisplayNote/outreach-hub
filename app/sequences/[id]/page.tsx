import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { z } from 'zod';
import { getSequenceWithSteps, listTemplates } from '@/lib/db/queries';
import {
  addSequenceStep,
  deleteSequence,
  deleteSequenceStep,
  updateSequence,
} from '@/lib/actions/sequences';
import type { TouchpointChannel } from '@/lib/types/domain';
import { TOUCHPOINT_CHANNELS } from '@/lib/types/domain';
import { Badge, Button, Card, CountBadge, EmptyState, Field, Icon } from '@/components/ui';

// Auth state + sequence/step data change per request; never prerender (ADR 004).
export const dynamic = 'force-dynamic';

const uuid = z.string().uuid();

/** Human-readable label for each touchpoint channel, in schema order. */
const CHANNEL_LABELS: Record<TouchpointChannel, string> = {
  email: 'Email',
  phone: 'Phone',
  linkedin: 'LinkedIn',
  other: 'Other',
};

// --- Page --------------------------------------------------------------------

export default async function SequenceEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const sequence = await getSequenceWithSteps(id);

  if (!sequence) {
    notFound();
  }

  const templates = await listTemplates();
  const templateNameById = new Map(templates.map((t) => [t.id, t.name]));

  // --- Server Actions (FormData adapters over the typed domain actions) -------

  async function renameAction(formData: FormData): Promise<void> {
    'use server';
    await updateSequence(id, {
      name: String(formData.get('name') ?? '').trim(),
    });
    redirect(`/sequences/${id}`);
  }

  async function addStepAction(formData: FormData): Promise<void> {
    'use server';

    const channel = String(formData.get('channel') ?? '') as TouchpointChannel;

    // A blank template select means "no template" → null.
    const rawTemplate = String(formData.get('templateId') ?? '').trim();
    const templateId = rawTemplate === '' ? null : uuid.parse(rawTemplate);

    await addSequenceStep(id, {
      dayOffset: Number(formData.get('dayOffset') ?? 0),
      channel,
      templateId,
    });
    redirect(`/sequences/${id}`);
  }

  async function deleteStepAction(formData: FormData): Promise<void> {
    'use server';
    const stepId = uuid.parse(formData.get('stepId'));
    await deleteSequenceStep(stepId);
    redirect(`/sequences/${id}`);
  }

  async function deleteSequenceAction(): Promise<void> {
    'use server';
    await deleteSequence(id);
    redirect('/sequences');
  }

  return (
    <div className="content__inner">
      <div className="page-head">
        <div>
          <p style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--fs-sm)' }}>
            <Link href="/sequences" className="muted">
              ← Sequences
            </Link>
          </p>
          <div className="page-head__title">{sequence.name}</div>
          <div className="page-head__sub">Reusable outreach cadence and its ordered steps.</div>
        </div>
        <div className="page-actions">
          <form action={deleteSequenceAction}>
            <Button type="submit" variant="danger">
              Delete sequence
            </Button>
          </form>
        </div>
      </div>

      {/* Rename --------------------------------------------------------------- */}
      <Card title="Sequence name">
        <form action={renameAction} className="row gap-4" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 1, maxWidth: 420 }}>
            <Field label="Name" htmlFor="name" required>
              <input
                id="name"
                name="name"
                type="text"
                required
                defaultValue={sequence.name}
                className="input"
              />
            </Field>
          </div>
          <Button type="submit" variant="secondary">
            Rename
          </Button>
        </form>
      </Card>

      {/* Steps ---------------------------------------------------------------- */}
      <div style={{ marginTop: 'var(--space-6)' }}>
        <Card title="Steps" bodyStyle={{ padding: 0 }}>
          <div style={{ padding: 'var(--space-5) var(--space-6) 0' }}>
            <p className="sm muted" style={{ margin: 0 }}>
              Ordered touchpoints, each scheduled a number of days from the sequence start.
            </p>
          </div>

        {sequence.steps.length === 0 ? (
          <EmptyState
            icon="sequence"
            title="No steps yet"
            desc="Add the first step below."
          />
        ) : (
          <div style={{ padding: 'var(--space-6)' }} className="col gap-4">
            {sequence.steps.map((step) => (
              <div
                key={step.id}
                className="card row gap-5 center between"
                style={{ padding: 'var(--space-5) var(--space-6)' }}
              >
                <div className="row gap-5 center" style={{ minWidth: 0 }}>
                  <CountBadge tone="neutral">{step.stepOrder}</CountBadge>
                  <div className="col gap-2" style={{ minWidth: 0 }}>
                    <div className="row gap-4 center wrap">
                      <span className="semib sm">{CHANNEL_LABELS[step.channel]}</span>
                      <Badge tone="neutral">Day {step.dayOffset}</Badge>
                      {step.templateId && (
                        <Badge tone="accent">
                          {templateNameById.get(step.templateId) ?? 'Unknown template'}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <form action={deleteStepAction}>
                  <input type="hidden" name="stepId" value={step.id} />
                  <Button type="submit" variant="danger" size="sm">
                    Delete
                  </Button>
                </form>
              </div>
            ))}
          </div>
        )}
        </Card>
      </div>

      {/* Add step ------------------------------------------------------------- */}
      <div style={{ marginTop: 'var(--space-6)' }}>
        <Card title="Add a step">
          <form action={addStepAction}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 'var(--space-6)',
            }}
          >
            <Field label="Day offset" htmlFor="dayOffset" required>
              <input
                id="dayOffset"
                name="dayOffset"
                type="number"
                min={0}
                step={1}
                required
                defaultValue={0}
                className="input"
              />
            </Field>

            <Field label="Channel" htmlFor="channel" required>
              <div className="select-wrap">
                <select
                  id="channel"
                  name="channel"
                  required
                  defaultValue="email"
                  className="input"
                >
                  {TOUCHPOINT_CHANNELS.map((channel) => (
                    <option key={channel} value={channel}>
                      {CHANNEL_LABELS[channel]}
                    </option>
                  ))}
                </select>
                <span className="select-chevron">
                  <Icon name="chevronDown" size={15} />
                </span>
              </div>
            </Field>

            <Field label="Template" htmlFor="templateId">
              <div className="select-wrap">
                <select id="templateId" name="templateId" defaultValue="" className="input">
                  <option value="">No template</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
                <span className="select-chevron">
                  <Icon name="chevronDown" size={15} />
                </span>
              </div>
            </Field>
          </div>

          <div className="row" style={{ marginTop: 'var(--space-6)' }}>
            <Button type="submit" variant="primary">
              Add step
            </Button>
          </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
