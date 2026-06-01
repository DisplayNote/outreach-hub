'use client';

import { useActionState } from 'react';
import type { OrgSettings } from '@/lib/types/domain';
import { Button, Card, Field, Icon } from '@/components/ui';

/**
 * Org settings form. Renders one control per editable `OrgSettings` field,
 * pre-filled from the current settings, and submits to a passed-in Server
 * Action via `useActionState` so the page can surface inline success / error
 * feedback without a navigation.
 *
 * The action receives the form's FormData, parses + validates it (numbers as
 * numbers), calls `updateOrgSettings`, and returns a `SettingsFormState`. We
 * keep the action state here (rather than a redirect) because Settings is a
 * stay-in-place edit screen.
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
  /** Current org settings, used to pre-fill the controls. */
  settings: OrgSettings;
}

/** Coerce an optional number to a string for a controlled-ish number input. */
function numValue(v: number | undefined): string {
  if (v === undefined) return '';
  return String(v);
}

export default function SettingsForm({ action, settings }: SettingsFormProps) {
  const [state, formAction, pending] = useActionState(action, INITIAL_SETTINGS_STATE);

  return (
    <form action={formAction}>
      <div className="col gap-6">
        <Card title="Goals">
          <div style={gridStyle}>
            <Field label="Daily goal" htmlFor="dailyGoal" hint="Contacts to action per day.">
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

            <Field label="Weekly calls goal" htmlFor="weeklyCallsGoal">
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

            <Field label="Weekly emails goal" htmlFor="weeklyEmailsGoal">
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
            <Field label="Green" htmlFor="rhythmGreen">
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

            <Field label="Amber" htmlFor="rhythmAmber">
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

            <Field label="Red" htmlFor="rhythmRed">
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

            <Field label="No status" htmlFor="rhythmNone">
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

        <Card title="Defaults">
          <div className="col gap-6">
            <Field
              label="Default country code"
              htmlFor="defaultCountryCode"
              hint="Calling code used to normalise phone numbers, e.g. +44, +1, +34."
            >
              <input
                id="defaultCountryCode"
                name="defaultCountryCode"
                type="text"
                defaultValue={settings.defaultCountryCode ?? ''}
                className="input"
              />
            </Field>

            <Field label="Email signature" htmlFor="signature">
              <textarea
                id="signature"
                name="signature"
                rows={5}
                defaultValue={settings.signature ?? ''}
                className="input"
                style={{ resize: 'vertical' }}
              />
            </Field>

            <label htmlFor="seqSkipWeekends" className="row gap-4 center" style={{ cursor: 'pointer' }}>
              <input
                id="seqSkipWeekends"
                name="seqSkipWeekends"
                type="checkbox"
                defaultChecked={settings.seqSkipWeekends ?? false}
                style={{ width: '1rem', height: '1rem' }}
              />
              <span className="field-label" style={{ marginBottom: 0 }}>
                Skip weekends when scheduling sequence steps
              </span>
            </label>
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
