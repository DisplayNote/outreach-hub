'use client';

import { useActionState } from 'react';
import type { OrgSettings } from '@/lib/types/domain';
import { Button, Card, Field, Icon } from '@/components/ui';

/**
 * Account-tier settings form for the /admin panel. Renders the per-account
 * settings (sequence sender day-spread, org defaults, Zoho integration) and
 * submits to a passed-in Server Action via `useActionState` for inline feedback,
 * mirroring the per-user {@link import('./settings-form')} conventions.
 *
 * Access is gated upstream by `requireAdmin()` in the page — this component is
 * presentation only.
 */

export interface AdminSettingsFormState {
  status: 'idle' | 'success' | 'error';
  message: string;
}

export const INITIAL_ADMIN_SETTINGS_STATE: AdminSettingsFormState = {
  status: 'idle',
  message: '',
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 'var(--space-6)',
};

export interface AdminSettingsFormProps {
  action: (
    prevState: AdminSettingsFormState,
    formData: FormData,
  ) => Promise<AdminSettingsFormState>;
  settings: OrgSettings;
}

function numValue(v: number | undefined): string {
  return v === undefined ? '' : String(v);
}

export default function AdminSettingsForm({ action, settings }: AdminSettingsFormProps) {
  const [state, formAction, pending] = useActionState(action, INITIAL_ADMIN_SETTINGS_STATE);

  return (
    <form action={formAction}>
      <div className="col gap-6">
        <Card title="Sequence sender limits">
          <p className="sm tert" style={{ margin: '0 0 var(--space-6)' }}>
            Account-wide guardrails for the email sender. It sends up to the daily
            cap per day, most-overdue first, only within the send window (UK time)
            and never on skipped weekends. These limits apply to both the scheduled
            run and &ldquo;Run sender now&rdquo;. Leave the window blank for no
            time-of-day limit.
          </p>
          <div style={gridStyle}>
            <Field label="Daily send cap (max)" htmlFor="seqDailyCap">
              <input
                id="seqDailyCap"
                name="seqDailyCap"
                type="number"
                min={0}
                step={1}
                defaultValue={numValue(settings.seqDailyCap)}
                className="input"
              />
            </Field>

            <Field label="Skip weekends" htmlFor="seqSkipWeekends">
              <select
                id="seqSkipWeekends"
                name="seqSkipWeekends"
                defaultValue={settings.seqSkipWeekends ?? true ? 'true' : 'false'}
                className="input"
              >
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </Field>

            <Field label="Send window: from (UK hour, 0–23)" htmlFor="seqSendWindowFrom">
              <input
                id="seqSendWindowFrom"
                name="seqSendWindowFrom"
                type="number"
                min={0}
                max={23}
                step={1}
                defaultValue={numValue(settings.seqSendWindowFrom)}
                className="input"
              />
            </Field>

            <Field label="Send window: to (UK hour, 0–23)" htmlFor="seqSendWindowTo">
              <input
                id="seqSendWindowTo"
                name="seqSendWindowTo"
                type="number"
                min={0}
                max={23}
                step={1}
                defaultValue={numValue(settings.seqSendWindowTo)}
                className="input"
              />
            </Field>
          </div>
        </Card>

        <Card title="Defaults">
          <Field
            label="Default country code"
            htmlFor="defaultCountryCode"
            hint="Calling code used to normalise phone numbers org-wide, e.g. +44, +1, +34."
          >
            <input
              id="defaultCountryCode"
              name="defaultCountryCode"
              type="text"
              defaultValue={settings.defaultCountryCode ?? ''}
              className="input"
            />
          </Field>
        </Card>

        <Card title="Zoho CRM">
          <Field
            label="New-lead URL"
            htmlFor="zohoCrmUrl"
            hint="Base URL of your Zoho new-lead page. Used by the one-click push to Zoho."
          >
            <input
              id="zohoCrmUrl"
              name="zohoCrmUrl"
              type="url"
              defaultValue={settings.zohoCrmUrl ?? ''}
              className="input"
              placeholder="https://crm.zoho.com/crm/orgXXXX/tab/Leads/create"
            />
          </Field>
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
            {pending ? 'Saving…' : 'Save account settings'}
          </Button>
        </div>
      </div>
    </form>
  );
}
