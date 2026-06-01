'use client';
import { useEffect, useState, type ReactNode } from 'react';
import Sidebar from './sidebar';
import Topbar from './topbar';
import CommandPalette from './command-palette';

export interface ShellUser {
  email: string;
  name: string;
  initials: string;
  mailbox: string;
}

export default function AppShellClient({
  user,
  org,
  isAdmin,
  children,
}: {
  user: ShellUser;
  org: string;
  isAdmin: boolean;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) return;
      // Don't hijack ⌘K/Ctrl+K (or override the native shortcut) while the user
      // is typing in a form control. The palette can still be closed via Esc or
      // clicking outside.
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      setCmdOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`app ${collapsed ? 'is-collapsed' : ''}`}>
      <Sidebar user={user} org={org} collapsed={collapsed} isAdmin={isAdmin} />
      <div className="main">
        <Topbar
          user={user}
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
          onOpenCommand={() => setCmdOpen(true)}
        />
        <div className="content">{children}</div>
      </div>
      <CommandPalette key={cmdOpen ? 'open' : 'closed'} open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  );
}
