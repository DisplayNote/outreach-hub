import AdminSettingsForm from '@/components/admin-settings-form';
import type { AdminSettingsFormState } from '@/components/admin-settings-form';
import { updateOrgSettings } from '@/lib/actions/settings';
import type { UpdateOrgSettingsInput } from '@/lib/actions/settings';
import { requireAdmin } from '@/lib/auth/admin';
import { getOrgSettings } from '@/lib/supabase/queries';

// Auth + admin gate + org settings all change per request; never prerender.
export const dynamic = 'force-dynamic';

// --- FormData parsing ---------------------------------------------------------

function intField(formData: FormData, key: string): number | undefined {
  const raw = formData.get(key);
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return undefined;
  return n;
}

function textField(formData: FormData, key: string): string | undefined {
  const raw = formData.get(key);
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** A yes/no `<select>` whose value is "true" or "false". Always set. */
function selectBoolField(formData: FormData, key: string): boolean {
  return formData.get(key) === 'true';
}

export default async function AdminPage() {
  // Gate FIRST — 404s for non-allowlisted emails before any data is loaded.
  await requireAdmin();

  const settings = await getOrgSettings();

  async function action(
    _prev: AdminSettingsFormState,
    formData: FormData,
  ): Promise<AdminSettingsFormState> {
    'use server';
    // Re-assert admin inside the action: a server action is an independent
    // entry point, so it must not trust that the page-render gate ran.
    await requireAdmin();

    const patch: UpdateOrgSettingsInput = {
      seqDailyCap: intField(formData, 'seqDailyCap'),
      seqSendWindowFrom: intField(formData, 'seqSendWindowFrom'),
      seqSendWindowTo: intField(formData, 'seqSendWindowTo'),
      seqSkipWeekends: selectBoolField(formData, 'seqSkipWeekends'),
      defaultCountryCode: textField(formData, 'defaultCountryCode'),
      zohoCrmUrl: textField(formData, 'zohoCrmUrl'),
    };

    try {
      await updateOrgSettings(patch);
      return { status: 'success', message: 'Account settings saved.' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save settings.';
      return { status: 'error', message };
    }
  }

  return (
    <div className="content__inner" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <div>
          <div className="page-head__title">Admin</div>
          <div className="page-head__sub">
            Account-wide settings — sequence sender, defaults, and integrations.
          </div>
        </div>
      </div>
      <AdminSettingsForm action={action} settings={settings} />
    </div>
  );
}
