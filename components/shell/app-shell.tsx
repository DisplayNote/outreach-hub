import type { ReactNode } from 'react';
import { getSession } from '@/lib/auth/session';
import { getCurrentOrgName } from '@/lib/db/queries';
import { isAdminEmail } from '@/lib/auth/admin';
import AppShellClient from './app-shell-client';

export default async function AppShell({ children }: { children: ReactNode }) {
  const session = await getSession();

  if (!session) return <>{children}</>;

  // email is normally present (Entra ID), but some providers may omit it;
  // fall back to a stable identifier so the shell never renders blank chrome.
  const email = session.email ?? '';
  const mailbox = email || session.userId;
  const initials = (email.slice(0, 2) || 'OH').toUpperCase();
  // Real org name (RLS-scoped) instead of a hard-coded label; fall back if
  // absent. We don't throw — a missing/failed org name should never break the
  // shell on every page — but we log any error so an RLS misconfig is findable.
  let org = 'Outreach Hub';
  try {
    org = (await getCurrentOrgName()) ?? 'Outreach Hub';
  } catch (orgError) {
    console.error('AppShell: failed to load org name', orgError);
  }

  return (
    <AppShellClient
      user={{ email, name: email.split('@')[0] || 'User', initials, mailbox }}
      org={org}
      isAdmin={isAdminEmail(email)}
    >
      {children}
    </AppShellClient>
  );
}
