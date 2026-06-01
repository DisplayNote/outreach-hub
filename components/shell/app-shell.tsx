import type { ReactNode } from 'react';
import { createClient } from '@/lib/supabase/server';
import AppShellClient from './app-shell-client';

export default async function AppShell({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return <>{children}</>;

  // email is normally present (Entra ID), but some auth providers may omit it;
  // fall back to a stable identifier so the shell never renders blank chrome.
  const email = user.email ?? '';
  const mailbox = email || user.id;
  const initials = (email.slice(0, 2) || 'OH').toUpperCase();
  // Real org name (RLS-scoped) instead of a hard-coded label, read via the
  // client already created above; fall back if absent. No throw — a missing
  // org name should never break the shell on every page.
  const { data: orgRow } = await supabase.from('organizations').select('name').maybeSingle();
  const org = (orgRow as { name: string | null } | null)?.name ?? 'Outreach Hub';

  return (
    <AppShellClient
      user={{ email, name: email.split('@')[0] || 'User', initials, mailbox }}
      org={org}
    >
      {children}
    </AppShellClient>
  );
}
