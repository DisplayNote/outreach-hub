import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getSequenceWithSteps, listTemplates } from '@/lib/supabase/queries';
import {
  addSequenceStep,
  deleteSequence,
  deleteSequenceStep,
  updateSequence,
} from '@/lib/actions/sequences';
import type { TouchpointChannel } from '@/lib/types/domain';
import { TOUCHPOINT_CHANNELS } from '@/lib/types/domain';

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

// --- Inline styles (Tailwind is not wired yet; mirror app/contacts/page.tsx) --

const mainStyle: React.CSSProperties = {
  padding: '2rem',
  fontFamily: 'system-ui, sans-serif',
  maxWidth: 960,
  margin: '0 auto',
};

const cellStyle: React.CSSProperties = {
  padding: '0.625rem 0.75rem',
  borderBottom: '1px solid #eee',
  textAlign: 'left',
  verticalAlign: 'top',
};

const headStyle: React.CSSProperties = {
  ...cellStyle,
  borderBottom: '2px solid #ddd',
  fontWeight: 600,
  color: '#555',
  fontSize: '0.8125rem',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};

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

const deleteButtonStyle: React.CSSProperties = {
  padding: '0.3rem 0.6rem',
  background: '#fff',
  color: '#b91c1c',
  border: '1px solid #e5b4b4',
  borderRadius: 4,
  fontSize: '0.8125rem',
  cursor: 'pointer',
};

const sectionStyle: React.CSSProperties = {
  marginTop: '2.5rem',
  padding: '1.5rem',
  background: '#fafafa',
  border: '1px solid #eee',
  borderRadius: 6,
};

// --- Page --------------------------------------------------------------------

export default async function SequenceEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
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
    <main style={mainStyle}>
      <p style={{ marginTop: 0, marginBottom: '0.75rem', fontSize: '0.875rem' }}>
        <Link href="/sequences" style={{ color: '#374151' }}>
          ← Sequences
        </Link>
      </p>

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '1rem',
        }}
      >
        <h1 style={{ marginTop: 0, marginBottom: '0.25rem' }}>{sequence.name}</h1>
        <form action={deleteSequenceAction} style={{ flexShrink: 0 }}>
          <button type="submit" style={deleteButtonStyle}>
            Delete sequence
          </button>
        </form>
      </div>

      {/* Rename --------------------------------------------------------------- */}
      <form
        action={renameAction}
        style={{ display: 'flex', alignItems: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}
      >
        <div style={{ flex: 1, maxWidth: 420 }}>
          <label htmlFor="name" style={labelStyle}>
            Name *
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            defaultValue={sequence.name}
            style={fieldStyle}
          />
        </div>
        <button type="submit" style={submitStyle}>
          Rename
        </button>
      </form>

      {/* Steps ---------------------------------------------------------------- */}
      <h2 style={{ marginTop: '2.5rem', marginBottom: '0.25rem', fontSize: '1.15rem' }}>Steps</h2>
      <p style={{ marginTop: 0, color: '#666', fontSize: '0.9rem' }}>
        Ordered touchpoints, each scheduled a number of days from the sequence start.
      </p>

      {sequence.steps.length === 0 ? (
        <div
          style={{
            marginTop: '1rem',
            padding: '1.5rem',
            textAlign: 'center',
            color: '#666',
            background: '#fafafa',
            border: '1px solid #eee',
            borderRadius: 6,
          }}
        >
          <p style={{ margin: 0, fontSize: '0.95rem' }}>No steps yet.</p>
          <p style={{ margin: '0.4rem 0 0', fontSize: '0.875rem' }}>
            Add the first step below.
          </p>
        </div>
      ) : (
        <table
          style={{
            marginTop: '1rem',
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '0.9375rem',
          }}
        >
          <thead>
            <tr>
              <th style={{ ...headStyle, width: '1%' }} scope="col">
                #
              </th>
              <th style={headStyle} scope="col">
                Day offset
              </th>
              <th style={headStyle} scope="col">
                Channel
              </th>
              <th style={headStyle} scope="col">
                Template
              </th>
              <th style={{ ...headStyle, textAlign: 'right', width: '1%' }} scope="col">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {sequence.steps.map((step) => (
              <tr key={step.id}>
                <td style={cellStyle}>{step.stepOrder}</td>
                <td style={cellStyle}>
                  Day {step.dayOffset}
                </td>
                <td style={cellStyle}>{CHANNEL_LABELS[step.channel]}</td>
                <td style={cellStyle}>
                  {step.templateId
                    ? (templateNameById.get(step.templateId) ?? 'Unknown template')
                    : '—'}
                </td>
                <td style={{ ...cellStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <form action={deleteStepAction} style={{ display: 'inline' }}>
                    <input type="hidden" name="stepId" value={step.id} />
                    <button type="submit" style={deleteButtonStyle}>
                      Delete
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Add step ------------------------------------------------------------- */}
      <section style={sectionStyle}>
        <h2 style={{ marginTop: 0, marginBottom: '1rem', fontSize: '1.05rem' }}>Add a step</h2>
        <form action={addStepAction}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: '0 1.25rem',
            }}
          >
            <div style={{ marginBottom: '1.1rem' }}>
              <label htmlFor="dayOffset" style={labelStyle}>
                Day offset *
              </label>
              <input
                id="dayOffset"
                name="dayOffset"
                type="number"
                min={0}
                step={1}
                required
                defaultValue={0}
                style={fieldStyle}
              />
            </div>

            <div style={{ marginBottom: '1.1rem' }}>
              <label htmlFor="channel" style={labelStyle}>
                Channel *
              </label>
              <select id="channel" name="channel" required defaultValue="email" style={fieldStyle}>
                {TOUCHPOINT_CHANNELS.map((channel) => (
                  <option key={channel} value={channel}>
                    {CHANNEL_LABELS[channel]}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '1.1rem' }}>
              <label htmlFor="templateId" style={labelStyle}>
                Template
              </label>
              <select id="templateId" name="templateId" defaultValue="" style={fieldStyle}>
                <option value="">No template</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ marginTop: '0.5rem' }}>
            <button type="submit" style={submitStyle}>
              Add step
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
