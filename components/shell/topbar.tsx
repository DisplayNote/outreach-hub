'use client';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { titleForPath } from './nav-config';
import Icon from '@/components/ui/icon';
import type { ShellUser } from './app-shell-client';

export default function Topbar({
  user,
  collapsed,
  onToggle,
  onOpenCommand,
}: {
  user: ShellUser;
  collapsed: boolean;
  onToggle: () => void;
  onOpenCommand: () => void;
}) {
  const pathname = usePathname();
  // Lazy initializer reads the data-theme the no-FOUC script applied before
  // hydration, so the toggle icon matches the active theme without a
  // setState-in-effect round-trip.
  const [isDark, setIsDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark',
  );

  const toggleTheme = () => {
    const next = isDark ? 'light' : 'dark';
    if (next === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    try {
      localStorage.setItem('theme', next);
    } catch {
      // localStorage may be unavailable (private mode); toggle still applies.
    }
    setIsDark(next === 'dark');
  };

  return (
    <header className="topbar">
      <button
        type="button"
        className="topbar__collapse"
        onClick={onToggle}
        aria-label="Toggle sidebar"
        title={collapsed ? 'Expand' : 'Collapse'}
      >
        <Icon name="chevronsLeft" size={18} />
      </button>
      <div className="topbar__title">{titleForPath(pathname)}</div>
      <div style={{ flex: 1 }} />
      <button type="button" className="topbar__search focusable" onClick={onOpenCommand}>
        <Icon name="search" size={15} />
        <span>Search or jump to…</span>
        <kbd className="kbd">⌘K</kbd>
      </button>
      <button
        type="button"
        className="topbar__icon-btn"
        onClick={toggleTheme}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        <Icon name={isDark ? 'sun' : 'moon'} size={18} />
      </button>
      <div className="sending-as" title={`Sending as ${user.mailbox}`}>
        <span className="sending-as__dot" />
        <Icon name="microsoft" size={13} />
        <span>{user.mailbox.split('@')[0]}</span>
      </div>
    </header>
  );
}
