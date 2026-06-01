'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_GROUPS } from './nav-config';
import Icon from '@/components/ui/icon';
import type { ShellUser } from './app-shell-client';

export default function Sidebar({
  user,
  org,
  collapsed,
}: {
  user: ShellUser;
  org: string;
  collapsed: boolean;
}) {
  const pathname = usePathname();
  return (
    <nav className="sidebar">
      <div className="sidebar__brand">
        <div className="sidebar__logo">O</div>
        {!collapsed && (
          <div style={{ minWidth: 0 }}>
            <div className="sidebar__name">Outreach Hub</div>
            <div className="sidebar__org">{org}</div>
          </div>
        )}
      </div>
      <div className="sidebar__scroll">
        {NAV_GROUPS.map((g) => (
          <div key={g.group}>
            <div className="nav-group-label">{collapsed ? '·' : g.group}</div>
            {g.items.map((it) => {
              const active = pathname === it.href || pathname.startsWith(`${it.href}/`);
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  className={`nav-item ${active ? 'is-active' : ''}`}
                  aria-label={it.label}
                  title={it.label}
                >
                  <span className="nav-item__icon">
                    <Icon name={it.icon} size={18} />
                  </span>
                  <span className="nav-item__label">{it.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </div>
      <div className="sidebar__foot">
        <form action="/auth/signout" method="post">
          <div className="sidebar-user" style={{ width: '100%' }}>
            <span className="avatar avatar--md">{user.initials}</span>
            {!collapsed && (
              <div className="sidebar-user__meta">
                <div className="sidebar-user__name">{user.name}</div>
                <div className="sidebar-user__mail">{user.mailbox}</div>
              </div>
            )}
            <button
              type="submit"
              className="nav-item"
              style={{ width: 'auto', padding: '0 8px' }}
              aria-label="Sign out"
              title="Sign out"
            >
              <Icon name="logout" size={16} />
            </button>
          </div>
        </form>
      </div>
    </nav>
  );
}
