import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

// Top navigation, rendered for authenticated users only. Returns null when
// signed out (e.g. the /login page) so the bar stays hidden there. Server
// component — the auth check relies on the request cookies.

const barStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '1rem',
  padding: '0.75rem 1.25rem',
  borderBottom: '1px solid #e5e7eb',
  fontFamily: 'system-ui, sans-serif',
};

const linksStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '1.25rem',
};

const NAV_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/today', label: 'Today' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/dialler', label: 'Dialler' },
  { href: '/contacts', label: 'Contacts' },
  { href: '/campaigns', label: 'Campaigns' },
  { href: '/sequences', label: 'Sequences' },
  { href: '/templates', label: 'Templates' },
  { href: '/activity', label: 'Activity' },
  { href: '/reports', label: 'Reports' },
  { href: '/import', label: 'Import' },
  { href: '/settings', label: 'Settings' },
];

const brandStyle: React.CSSProperties = {
  fontWeight: 700,
  textDecoration: 'none',
  color: '#111',
};

const linkStyle: React.CSSProperties = {
  textDecoration: 'none',
  color: '#374151',
  fontSize: '0.9375rem',
};

const signOutStyle: React.CSSProperties = {
  padding: '0.35rem 0.75rem',
  cursor: 'pointer',
  background: '#f3f4f6',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  fontSize: '0.875rem',
};

export default async function SiteNav() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  return (
    <nav style={barStyle}>
      <div style={linksStyle}>
        <Link href="/" style={brandStyle}>
          Outreach Hub
        </Link>
        {NAV_LINKS.map((link) => (
          <Link key={link.href} href={link.href} style={linkStyle}>
            {link.label}
          </Link>
        ))}
      </div>
      <form action="/auth/signout" method="post">
        <button type="submit" style={signOutStyle}>
          Sign out
        </button>
      </form>
    </nav>
  );
}
