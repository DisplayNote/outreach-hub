'use client';

import { useActionState } from 'react';
import type { OrgSettings } from '@/lib/types/domain';

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
 * Styling mirrors the inline-style approach used elsewhere (Tailwind is not
 * wired yet — see app/today/page.tsx and components/contact-form.tsx).
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

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8125rem',
  fontWeight: 600,
  color: '#374151',
  marginBottom: '0.35rem',
};

const helpStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.75rem',
  fontWeight: 400,
  color: '#888',
  marginTop: '0.25rem',
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

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '0 1.25rem',
};

const sectionStyle: React.CSSProperties = {
  marginTop: '2rem',
  paddingTop: '1.5rem',
  borderTop: '1px solid #eee',
};

const sectionHeadingStyle: React.CSSProperties = {
  margin: '0 0 1rem',
  fontSize: '1rem',
  fontWeight: 600,
  color: '#111',
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

const checkboxRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
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

/** Coerce a nullable number to a string for a controlled-ish number input. */
function numValue(v: number | undefined): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

export default function SettingsForm({ action, settings }: SettingsFormProps) {
  const [state, formAction, pending] = useActionState(action, INITIAL_SETTINGS_STATE);

  return (
    <form action={formAction} style={{ fontFamily: 'system-ui, sans-serif' }}>
      <section>
        <h2 style={{ ...sectionHeadingStyle, marginTop: 0 }}>Goals</h2>
        <div style={gridStyle}>
          <div style={fieldGroupStyle}>
            <label htmlFor="dailyGoal" style={labelStyle}>
              Daily goal
            </label>
            <input
              id="dailyGoal"
              name="dailyGoal"
              type="number"
              min={0}
              step={1}
              defaultValue={numValue(settings.dailyGoal)}
              style={fieldStyle}
            />
            <span style={helpStyle}>Contacts to action per day.</span>
          </div>

          <div style={fieldGroupStyle}>
            <label htmlFor="weeklyCallsGoal" style={labelStyle}>
              Weekly calls goal
            </label>
            <input
              id="weeklyCallsGoal"
              name="weeklyCallsGoal"
              type="number"
              min={0}
              step={1}
              defaultValue={numValue(settings.weeklyCallsGoal)}
              style={fieldStyle}
            />
          </div>

          <div style={fieldGroupStyle}>
            <label htmlFor="weeklyEmailsGoal" style={labelStyle}>
              Weekly emails goal
            </label>
            <input
              id="weeklyEmailsGoal"
              name="weeklyEmailsGoal"
              type="number"
              min={0}
              step={1}
              defaultValue={numValue(settings.weeklyEmailsGoal)}
              style={fieldStyle}
            />
          </div>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionHeadingStyle}>Follow-up rhythm (days)</h2>
        <p style={{ marginTop: '-0.5rem', marginBottom: '1rem', fontSize: '0.8125rem', color: '#888' }}>
          Days until the next follow-up is due, by status.
        </p>
        <div style={gridStyle}>
          <div style={fieldGroupStyle}>
            <label htmlFor="rhythmGreen" style={labelStyle}>
              Green
            </label>
            <input
              id="rhythmGreen"
              name="rhythmGreen"
              type="number"
              min={0}
              step={1}
              defaultValue={numValue(settings.rhythmGreen)}
              style={fieldStyle}
            />
          </div>

          <div style={fieldGroupStyle}>
            <label htmlFor="rhythmAmber" style={labelStyle}>
              Amber
            </label>
            <input
              id="rhythmAmber"
              name="rhythmAmber"
              type="number"
              min={0}
              step={1}
              defaultValue={numValue(settings.rhythmAmber)}
              style={fieldStyle}
            />
          </div>

          <div style={fieldGroupStyle}>
            <label htmlFor="rhythmRed" style={labelStyle}>
              Red
            </label>
            <input
              id="rhythmRed"
              name="rhythmRed"
              type="number"
              min={0}
              step={1}
              defaultValue={numValue(settings.rhythmRed)}
              style={fieldStyle}
            />
          </div>

          <div style={fieldGroupStyle}>
            <label htmlFor="rhythmNone" style={labelStyle}>
              No status
            </label>
            <input
              id="rhythmNone"
              name="rhythmNone"
              type="number"
              min={0}
              step={1}
              defaultValue={numValue(settings.rhythmNone)}
              style={fieldStyle}
            />
          </div>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionHeadingStyle}>Defaults</h2>
        <div style={fieldGroupStyle}>
          <label htmlFor="defaultCountryCode" style={labelStyle}>
            Default country code
          </label>
          <input
            id="defaultCountryCode"
            name="defaultCountryCode"
            type="text"
            defaultValue={settings.defaultCountryCode ?? ''}
            style={fieldStyle}
          />
          <span style={helpStyle}>
            Calling code used to normalise phone numbers, e.g. +44, +1, +34.
          </span>
        </div>

        <div style={fieldGroupStyle}>
          <label htmlFor="signature" style={labelStyle}>
            Email signature
          </label>
          <textarea
            id="signature"
            name="signature"
            rows={5}
            defaultValue={settings.signature ?? ''}
            style={{ ...fieldStyle, resize: 'vertical' }}
          />
        </div>

        <div style={fieldGroupStyle}>
          <span style={checkboxRowStyle}>
            <input
              id="seqSkipWeekends"
              name="seqSkipWeekends"
              type="checkbox"
              defaultChecked={settings.seqSkipWeekends ?? false}
              style={{ width: '1rem', height: '1rem' }}
            />
            <label htmlFor="seqSkipWeekends" style={{ ...labelStyle, marginBottom: 0 }}>
              Skip weekends when scheduling sequence steps
            </label>
          </span>
        </div>
      </section>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '1.5rem' }}>
        <button type="submit" disabled={pending} style={submitStyle}>
          {pending ? 'Saving…' : 'Save settings'}
        </button>
        {state.status === 'success' ? (
          <span role="status" style={{ color: '#15803d', fontSize: '0.9375rem', fontWeight: 500 }}>
            {state.message}
          </span>
        ) : null}
        {state.status === 'error' ? (
          <span role="alert" style={{ color: '#b91c1c', fontSize: '0.9375rem', fontWeight: 500 }}>
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
