import type { ReactNode } from 'react';
import { createClient } from '@/lib/supabase/server';
import AppShellClient from './app-shell-client';

export default async function AppShell({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return <>{children}</>;

  const email = user.email ?? '';
  const initials = (email.slice(0, 2) || 'OH').toUpperCase();

  return (
    <AppShellClient
      user={{ email, name: email.split('@')[0] || 'User', initials, mailbox: email }}
    >
      {children}
    </AppShellClient>
  );
}
