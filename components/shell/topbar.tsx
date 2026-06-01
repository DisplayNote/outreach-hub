'use client';
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
      <div className="sending-as" title={`Sending as ${user.mailbox}`}>
        <span className="sending-as__dot" />
        <Icon name="microsoft" size={13} />
        <span
          style={{
            maxWidth: 160,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {user.mailbox.split('@')[0]}
        </span>
      </div>
    </header>
  );
}
