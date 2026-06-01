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

  return (
    <AppShellClient
      user={{ email, name: email.split('@')[0] || 'User', initials, mailbox }}
    >
      {children}
    </AppShellClient>
  );
}
