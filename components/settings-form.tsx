'use client';

import { useActionState, useState } from 'react';
import type { UserSettings } from '@/lib/types/domain';
import { Button, Card, Field, Icon } from '@/components/ui';

/**
 * Per-user settings form. Renders one control per editable `UserSettings` field,
 * pre-filled from the current settings, and submits to a passed-in Server Action
 * via `useActionState` so the page can surface inline success / error feedback
 * without a navigation.
 *
 * The action receives the form's FormData, parses + validates it (numbers as
 * numbers, repeated `snippet` inputs as a string[]), calls `updateUserSettings`,
 * and returns a `SettingsFormState`. We keep the action state here (rather than a
 * redirect) because Settings is a stay-in-place edit screen.
 *
 * Account-wide settings (sequence sender, Zoho, defaults, deployment config)
 * live in the separate /admin panel — this form is scoped to the signed-in user.
 *
 * Styling uses the shared design system (Card + Field + .input classes, Button
 * primitive) — see components/contact-form.tsx for established conventions.
 */

/** Result returned by the bound Server Action, used for inline feedback. */
export interface SettingsFormState {
  status: 'idle' | 'success' | 'error';
  message: string;
}

export const INITIAL_SETTINGS_STATE: SettingsFormState = {
  status: 'idle',
  message: '',
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 'var(--space-6)',
};

export interface SettingsFormProps {
  /** Server Action that receives FormData and returns the next form state. */
  action: (
    prevState: SettingsFormState,
    formData: FormData,
  ) => Promise<SettingsFormState>;
  /** Current per-user settings, used to pre-fill the controls. */
  settings: UserSettings;
}

/** Coerce an optional number to a string for a controlled-ish number input. */
function numValue(v: number | undefined): string {
  if (v === undefined) return '';
  return String(v);
}

/**
 * Note-snippets list editor. Holds the list in client state; each snippet
 * renders as an `<input name="snippet">` so the form submits them as repeated
 * fields (the action collects them via `formData.getAll('snippet')`). Adding
 * appends a blank row to edit; removing drops it. An empty list submits no
 * `snippet` fields, which the action reads as "clear all".
 */
function NoteSnippetsEditor({ initial }: { initial: string[] }) {
  const [snippets, setSnippets] = useState<string[]>(initial);

  function update(index: number, value: string) {
    setSnippets((prev) => prev.map((s, i) => (i === index ? value : s)));
  }
  function remove(index: number) {
    setSnippets((prev) => prev.filter((_, i) => i !== index));
  }
  function add() {
    setSnippets((prev) => [...prev, '']);
  }

  return (
    <div className="col gap-4">
      {snippets.length === 0 ? (
        <p className="sm tert" style={{ margin: 0 }}>
          No snippets yet. Add reusable quick notes to insert into note fields.
        </p>
      ) : (
        snippets.map((snippet, index) => (
          <div key={index} className="row gap-3 center">
            <input
              name="snippet"
              type="text"
              value={snippet}
              onChange={(e) => update(index, e.target.value)}
              className="input"
              placeholder="e.g. Asked for proposal, follow up Friday"
              style={{ flex: 1 }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon="x"
              aria-label="Remove snippet"
              onClick={() => remove(index)}
            />
          </div>
        ))
      )}
      <div>
        <Button type="button" variant="secondary" size="sm" icon="plus" onClick={add}>
          Add snippet
        </Button>
      </div>
    </div>
  );
}

export default function SettingsForm({ action, settings }: SettingsFormProps) {
  const [state, formAction, pending] = useActionState(action, INITIAL_SETTINGS_STATE);

  return (
    <form action={formAction}>
      <div className="col gap-6">
        <Card title="Goals">
          <div style={gridStyle}>
            <Field label="Daily touchpoints" htmlFor="dailyGoal" hint="Contacts to action per day.">
              <input
                id="dailyGoal"
                name="dailyGoal"
                type="number"
                min={0}
                step={1}
                defaultValue={numValue(settings.dailyGoal)}
                className="input"
              />
            </Field>

            <Field label="Weekly calls" htmlFor="weeklyCallsGoal">
              <input
                id="weeklyCallsGoal"
                name="weeklyCallsGoal"
                type="number"
                min={0}
                step={1}
                defaultValue={numValue(settings.weeklyCallsGoal)}
                className="input"
              />
            </Field>

            <Field label="Weekly emails" htmlFor="weeklyEmailsGoal">
              <input
                id="weeklyEmailsGoal"
                name="weeklyEmailsGoal"
                type="number"
                min={0}
                step={1}
                defaultValue={numValue(settings.weeklyEmailsGoal)}
                className="input"
              />
            </Field>
          </div>
        </Card>

        <Card title="Follow-up rhythm (days)">
          <p className="sm tert" style={{ margin: '0 0 var(--space-6)' }}>
            Days until the next follow-up is due, by status.
          </p>
          <div style={gridStyle}>
            <Field label="In conversation" htmlFor="rhythmGreen">
              <input
                id="rhythmGreen"
                name="rhythmGreen"
                type="number"
                min={0}
                step={1}
                defaultValue={numValue(settings.rhythmGreen)}
                className="input"
              />
            </Field>

            <Field label="No time yet" htmlFor="rhythmAmber">
              <input
                id="rhythmAmber"
                name="rhythmAmber"
                type="number"
                min={0}
                step={1}
                defaultValue={numValue(settings.rhythmAmber)}
                className="input"
              />
            </Field>

            <Field label="No response" htmlFor="rhythmRed">
              <input
                id="rhythmRed"
                name="rhythmRed"
                type="number"
                min={0}
                step={1}
                defaultValue={numValue(settings.rhythmRed)}
                className="input"
              />
            </Field>

            <Field label="Not contacted" htmlFor="rhythmNone">
              <input
                id="rhythmNone"
                name="rhythmNone"
                type="number"
                min={0}
                step={1}
                defaultValue={numValue(settings.rhythmNone)}
                className="input"
              />
            </Field>
          </div>
        </Card>

        <Card title="Email signature">
          <Field label="Signature" htmlFor="signature" hint="Appended to emails you send.">
            <textarea
              id="signature"
              name="signature"
              rows={5}
              defaultValue={settings.signature ?? ''}
              className="input"
              style={{ resize: 'vertical' }}
            />
          </Field>
        </Card>

        <Card title="Note snippets">
          <p className="sm tert" style={{ margin: '0 0 var(--space-6)' }}>
            Reusable quick notes you can insert into any note field.
          </p>
          <NoteSnippetsEditor initial={settings.noteSnippets ?? []} />
        </Card>

        <Card title="Telnyx dialler">
          <p className="sm tert" style={{ margin: '0 0 var(--space-6)' }}>
            Your dialling identity. The outbound caller ID is the number prospects
            see when you call. The shared Telnyx account is managed by an admin.
          </p>
          <div className="col gap-6">
            <Field
              label="SIP user"
              htmlFor="txSipUser"
              hint="Your Credential Connection username in the Telnyx portal."
            >
              <input
                id="txSipUser"
                name="txSipUser"
                type="text"
                defaultValue={settings.txSipUser ?? ''}
                className="input"
                placeholder="yourname"
                autoComplete="off"
              />
            </Field>

            <Field
              label="Outbound CLI (your number)"
              htmlFor="txCallerId"
              hint="The number prospects see when you call, e.g. +447712345678."
            >
              <input
                id="txCallerId"
                name="txCallerId"
                type="text"
                defaultValue={settings.txCallerId ?? ''}
                className="input"
                placeholder="+447712345678"
                autoComplete="off"
              />
            </Field>

            {/* TODO(softphone): a per-user SIP password field belongs here once a
                WebRTC softphone exists. It is a secret and must NOT be stored in
                user_settings.settings (jsonb is readable by the user and any
                service-role path) — store it Vault-backed in a restricted
                per-user secret store. No live consumer today (basic dialler uses
                tel: links; AMD bridges server-side via BRIDGE_SIP_USERNAME). */}
          </div>
        </Card>

        <Card title="Dialler preferences">
          <div style={gridStyle}>
            <Field
              label="Inter-call delay (sec)"
              htmlFor="diallerInterCallDelaySec"
              hint="Pause between consecutive auto-dial calls."
            >
              <input
                id="diallerInterCallDelaySec"
                name="diallerInterCallDelaySec"
                type="number"
                min={0}
                step={1}
                defaultValue={numValue(settings.diallerInterCallDelaySec)}
                className="input"
              />
            </Field>

            <Field label="Auto-dial mode" htmlFor="diallerAutoDial">
              <select
                id="diallerAutoDial"
                name="diallerAutoDial"
                defaultValue={settings.diallerAutoDial ? 'true' : 'false'}
                className="input"
              >
                <option value="false">Manual (click to dial each)</option>
                <option value="true">Auto (dial next after outcome)</option>
              </select>
            </Field>

            <Field label="Synth dial/ring tones" htmlFor="diallerSynthTones">
              <select
                id="diallerSynthTones"
                name="diallerSynthTones"
                defaultValue={settings.diallerSynthTones ? 'true' : 'false'}
                className="input"
              >
                <option value="false">Off (use Telnyx network ringback)</option>
                <option value="true">On (browser-generated tones)</option>
              </select>
            </Field>
          </div>
        </Card>

        <div className="row gap-4 center" style={{ justifyContent: 'flex-end' }}>
          {state.status === 'success' ? (
            <span role="status" className="row gap-3 center sm" style={{ color: 'var(--green-700)' }}>
              <Icon name="checkCircle" size={14} />
              {state.message}
            </span>
          ) : null}
          {state.status === 'error' ? (
            <span role="alert" className="row gap-3 center sm" style={{ color: 'var(--red-700)' }}>
              <Icon name="alertCircle" size={14} />
              {state.message}
            </span>
          ) : null}
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
      </div>
    </form>
  );
}
