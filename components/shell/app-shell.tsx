import type { ReactNode } from 'react';
import { createClient } from '@/lib/supabase/server';
import { getOrgName } from '@/lib/supabase/queries';
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
  // Real org name (RLS-scoped) instead of a hard-coded label; fall back if absent.
  const org = (await getOrgName()) ?? 'Outreach Hub';

  return (
    <AppShellClient
      user={{ email, name: email.split('@')[0] || 'User', initials, mailbox }}
      org={org}
    >
      {children}
    </AppShellClient>
  );
}
