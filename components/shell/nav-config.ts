export interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** When set, render a count badge sourced at render time. */
  badge?: 'queueDue';
}
export interface NavGroup {
  group: string;
  items: ReadonlyArray<NavItem>;
}

export const NAV_GROUPS: ReadonlyArray<NavGroup> = [
  {
    group: 'Outreach',
    items: [
      { href: '/today', label: 'Today', icon: 'dashboard' },
      { href: '/queue', label: 'Email Queue', icon: 'queue', badge: 'queueDue' },
      { href: '/dialler', label: 'Dialler', icon: 'dialler' },
      { href: '/pipeline', label: 'Pipeline', icon: 'pipeline' },
    ],
  },
  {
    group: 'Data',
    items: [
      { href: '/contacts', label: 'Contacts', icon: 'contacts' },
      { href: '/campaigns', label: 'Campaigns', icon: 'campaign' },
      { href: '/sequences', label: 'Sequences', icon: 'sequence' },
      { href: '/templates', label: 'Templates', icon: 'template' },
      { href: '/suppressions', label: 'Suppressions', icon: 'suppress' },
    ],
  },
  {
    group: 'Insights',
    items: [
      { href: '/reports', label: 'Reports', icon: 'reports' },
      { href: '/activity', label: 'Activity', icon: 'pipeline' },
      { href: '/import', label: 'Import', icon: 'userPlus' },
      { href: '/settings', label: 'Settings', icon: 'settings' },
    ],
  },
];

/** Pathname prefix → topbar title. Longest-prefix match wins. */
export const ROUTE_TITLES: ReadonlyArray<readonly [string, string]> = [
  ['/today', 'Today'],
  ['/queue', 'Email Queue'],
  ['/dialler', 'Dialler'],
  ['/pipeline', 'Pipeline'],
  ['/contacts', 'Contacts'],
  ['/campaigns', 'Campaigns'],
  ['/sequences', 'Sequences'],
  ['/templates', 'Templates'],
  ['/suppressions', 'Suppressions'],
  ['/reports', 'Reports'],
  ['/activity', 'Activity'],
  ['/import', 'Import'],
  ['/settings', 'Settings'],
];

export function titleForPath(pathname: string): string {
  let best = '';
  let bestTitle = '';
  for (const [prefix, title] of ROUTE_TITLES) {
    if (pathname.startsWith(prefix) && prefix.length > best.length) {
      best = prefix;
      bestTitle = title;
    }
  }
  return bestTitle;
}
