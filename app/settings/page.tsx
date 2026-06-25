import { redirect } from 'next/navigation';
import SettingsForm from '@/components/settings-form';
import type { SettingsFormState } from '@/components/settings-form';
import { updateUserSettings } from '@/lib/actions/user-settings';
import type { UpdateUserSettingsInput } from '@/lib/actions/user-settings';
import { getSession } from '@/lib/auth/session';
import { getUserSettings } from '@/lib/db/queries';

// Auth state + per-user settings change per request; never prerender (ADR 004).
export const dynamic = 'force-dynamic';

// --- FormData parsing ---------------------------------------------------------

/**
 * Parse a non-negative integer field. Returns `undefined` when blank/missing so
 * the patch omits it (read-merge-write in updateUserSettings won't clobber the
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

/**
 * Parse a yes/no `<select>` whose value is the string "true" or "false".
 * Always returns a boolean (the control is always present), so the key is
 * always set on save.
 */
function selectBoolField(formData: FormData, key: string): boolean {
  return formData.get(key) === 'true';
}

/**
 * Collect the note-snippets list editor's repeated `snippet` inputs into a
 * trimmed, blank-free string[]. The editor is the authoritative source, so we
 * always return the array (possibly empty) — that lets the user clear every
 * snippet, which a "blank means no-change" rule would make impossible.
 */
function snippetsField(formData: FormData): string[] {
  return formData
    .getAll('snippet')
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const settings = await getUserSettings();

  // Server Action bound to the form via useActionState. Parses the submitted
  // FormData into a typed patch (numbers as numbers, blanks omitted so they
  // don't clobber stored values), merges it via updateUserSettings, and returns
  // a SettingsFormState for inline feedback (no redirect — stay on the page).
  async function action(
    _prev: SettingsFormState,
    formData: FormData,
  ): Promise<SettingsFormState> {
    'use server';

    const patch: UpdateUserSettingsInput = {
      dailyGoal: intField(formData, 'dailyGoal'),
      weeklyCallsGoal: intField(formData, 'weeklyCallsGoal'),
      weeklyEmailsGoal: intField(formData, 'weeklyEmailsGoal'),
      rhythmGreen: intField(formData, 'rhythmGreen'),
      rhythmAmber: intField(formData, 'rhythmAmber'),
      rhythmRed: intField(formData, 'rhythmRed'),
      rhythmNone: intField(formData, 'rhythmNone'),
      signature: textField(formData, 'signature'),
      noteSnippets: snippetsField(formData),
      txSipUser: textField(formData, 'txSipUser'),
      txCallerId: textField(formData, 'txCallerId'),
      diallerInterCallDelaySec: intField(formData, 'diallerInterCallDelaySec'),
      // Selects are always present, so these keys are always set.
      diallerAutoDial: selectBoolField(formData, 'diallerAutoDial'),
      diallerSynthTones: selectBoolField(formData, 'diallerSynthTones'),
    };

    try {
      await updateUserSettings(patch);
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
          <div className="page-head__sub">
            Your goals, follow-up rhythm, snippets, and dialler settings.
          </div>
        </div>
      </div>
      <SettingsForm action={action} settings={settings} />
    </div>
  );
}
