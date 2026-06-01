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
  children,
}: {
  user: ShellUser;
  org: string;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`app ${collapsed ? 'is-collapsed' : ''}`}>
      <Sidebar user={user} org={org} collapsed={collapsed} />
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
