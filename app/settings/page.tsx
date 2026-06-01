import { redirect } from 'next/navigation';
import SettingsForm from '@/components/settings-form';
import type { SettingsFormState } from '@/components/settings-form';
import { updateOrgSettings } from '@/lib/actions/settings';
import type { UpdateOrgSettingsInput } from '@/lib/actions/settings';
import { createClient } from '@/lib/supabase/server';
import { getOrgSettings } from '@/lib/supabase/queries';

// Auth state + org settings change per request; never prerender.
export const dynamic = 'force-dynamic';

// --- FormData parsing ---------------------------------------------------------

/**
 * Parse a non-negative integer field. Returns `undefined` when blank/missing so
 * the patch omits it (read-merge-write in updateOrgSettings won't clobber the
 * stored value). A present-but-invalid value also collapses to `undefined`
 * rather than poisoning the patch — zod would otherwise reject the whole save.
 */
function intField(formData: FormData, key: string): number | undefined {
  const raw = formData.get(key);
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return undefined;
  return n;
}

/** Parse a trimmed text field. Returns `undefined` when blank/missing. */
function textField(formData: FormData, key: string): string | undefined {
  const raw = formData.get(key);
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** A checkbox is present in FormData only when checked. */
function boolField(formData: FormData, key: string): boolean {
  return formData.get(key) !== null;
}

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const settings = await getOrgSettings();

  // Server Action bound to the form via useActionState. Parses the submitted
  // FormData into a typed patch (numbers as numbers, blanks omitted so they
  // don't clobber stored values), merges it via updateOrgSettings, and returns
  // a SettingsFormState for inline feedback (no redirect — stay on the page).
  async function action(
    _prev: SettingsFormState,
    formData: FormData,
  ): Promise<SettingsFormState> {
    'use server';

    const patch: UpdateOrgSettingsInput = {
      dailyGoal: intField(formData, 'dailyGoal'),
      weeklyCallsGoal: intField(formData, 'weeklyCallsGoal'),
      weeklyEmailsGoal: intField(formData, 'weeklyEmailsGoal'),
      rhythmGreen: intField(formData, 'rhythmGreen'),
      rhythmAmber: intField(formData, 'rhythmAmber'),
      rhythmRed: intField(formData, 'rhythmRed'),
      rhythmNone: intField(formData, 'rhythmNone'),
      signature: textField(formData, 'signature'),
      defaultCountryCode: textField(formData, 'defaultCountryCode'),
      // boolField always returns a boolean (false when the checkbox is absent,
      // i.e. unchecked), so this key is always set.
      seqSkipWeekends: boolField(formData, 'seqSkipWeekends'),
    };

    try {
      await updateOrgSettings(patch);
      return { status: 'success', message: 'Settings saved.' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save settings.';
      return { status: 'error', message };
    }
  }

  return (
    <div className="content__inner" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <div>
          <div className="page-head__title">Settings</div>
          <div className="page-head__sub">Org-wide goals, follow-up rhythm, and defaults.</div>
        </div>
      </div>
      <SettingsForm action={action} settings={settings} />
    </div>
  );
}
