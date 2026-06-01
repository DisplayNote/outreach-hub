# Outreach Hub UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the entire authenticated Outreach Hub app to match the Claude Design "Outreach Hub" prototype, preserving 100% of existing functionality.

**Architecture:** Verbatim port of the prototype's CSS token/component system into `app/styles/`, a new server+client app shell (dark sidebar + topbar) replacing the horizontal top-nav, a small `components/ui/` primitive library re-authored as real React components, then per-page markup restyles that keep all data fetching, server actions, and test-coupled strings untouched. Presentation-only: no `lib/`, action, route-handler, or query changes.

**Tech Stack:** Next.js 15 (App Router, RSC), TypeScript strict, plain CSS + custom properties (no Tailwind), `next/font/google` (Geist + Geist Mono), Vitest, Playwright.

---

## Source-of-truth reference

The design prototype lives at `/tmp/outreach_design/` (unzipped from `Outreach Hub.zip`). Re-unzip if missing:

```bash
mkdir -p /tmp/outreach_design && cd /tmp/outreach_design && unzip -o "$HOME/Downloads/Outreach Hub.zip"
```

Key reference files (read for class names + structure ONLY — do not copy the `.jsx`/`data.js`):
- `tokens.css`, `components.css`, `shell.css`, `screens.css` — **these are copied verbatim**.
- `shell.jsx` — sidebar/topbar/command-palette structure.
- `components.jsx` — component class-name contracts (Button, Card, Pill, Badge, etc.).
- `screen-*.jsx` — per-screen markup patterns.
- `screenshots/*.png` — visual targets.

## Verification model (read before starting)

This is a **presentation-only** change. There are no new units to TDD; the regression harness is the **existing** suite plus the production build. Every task's verification gate is:

```bash
make typecheck   # tsc --noEmit — catches bad server/client boundaries & types
make lint        # eslint .
make test        # vitest (unit) — must stay green: proves no logic moved
make test-e2e    # playwright — must stay green: proves user-facing behavior intact
make build       # next build — proves RSC/client split is valid for production
```

Run the **full gate** at the end of every phase. Within a phase, after each task run the cheap subset (`make typecheck && make lint`) and the e2e spec(s) relevant to the touched page; run the full gate before the phase's final commit.

**String-preservation rule (NON-NEGOTIABLE):** these exact accessible-names / visible strings are asserted by e2e tests and MUST survive every restyle. Where the prototype uses a different label, the string below wins:
- `Sign in` (heading), `Sign in with Microsoft` (button), `Dev sign-in (mock)` (button)
- `Run sender now`, `Scan inbox now`, `Simulate inbound (dev)`, `Sim reply`, `Sim bounce`
- textbox accessible name `Contact email to simulate inbound from`
- result strings rendered by components: `Sent 2…`, `Simulated a reply`, `Simulated a bounce`, `1 repl…`
- `Start AMD Run`, `Mock dialler — no real calls placed`, `1 voicemails…`
- `rhea@e2e.example.com` must remain visible after dev sign-in

Before editing any page, grep the e2e specs for strings it renders:
```bash
grep -rn "getByRole\|getByText\|getByLabel\|locator" tests/e2e
```

**Hard constraints (from CLAUDE.md):** TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `noImplicitOverride`; no `@ts-ignore`; imports via `@/*`; `'use client'` only when needed; ambient CSS declarations in `global.d.ts` not `next-env.d.ts`; auth-gated server pages keep `export const dynamic = 'force-dynamic';`; branch per phase, squash-merge, Conventional Commits; never push to `main`; PR per phase.

---

## File Structure

**Created:**
- `app/styles/tokens.css` — verbatim copy of prototype tokens (custom properties, reset, base, keyframes).
- `app/styles/components.css` — verbatim copy of prototype component styles.
- `app/styles/shell.css` — verbatim copy of prototype shell layout styles.
- `app/styles/screens.css` — verbatim copy of prototype screen styles.
- `components/shell/app-shell.tsx` — **server** component: auth check + data gather; renders `AppShellClient` or bare children when signed out.
- `components/shell/app-shell-client.tsx` — **client** component: layout, collapse state, ⌘K state, dark-mode toggle.
- `components/shell/sidebar.tsx` — **client**: grouped nav, active route via `usePathname`, user dropdown + sign-out form.
- `components/shell/topbar.tsx` — **client**: collapse toggle, page title, sending-as chip, ⌘K entry, theme toggle.
- `components/shell/command-palette.tsx` — **client**: ⌘K page-navigation overlay.
- `components/shell/nav-config.ts` — nav groups + route→title map (shared, no `'use client'`).
- `components/ui/icon.tsx` — **client-safe** inline-SVG icon set ported from `icons.jsx` (only the icons actually used).
- `components/ui/button.tsx`, `badge.tsx`, `count-badge.tsx`, `avatar.tsx`, `card.tsx`, `pill.tsx`, `empty-state.tsx`, `stat-card.tsx`, `progress-ring.tsx`, `field.tsx` — primitives.
- `components/ui/index.ts` — barrel re-export.
- `lib/ui/status.ts` — maps existing `ContactStatus` → design pill tone/label/dot (presentation lookup; no logic).
- `app/theme-init.tsx` — tiny inline no-FOUC dark-mode script (Phase D).

**Modified:**
- `app/layout.tsx` — import stylesheets, wire `next/font` Geist, wrap children in `AppShell`.
- `app/globals.css` — reduced to a thin `@import` aggregator or removed in favor of `app/styles/*`.
- `global.d.ts` — add CSS-module/asset ambient declarations if needed (create if absent).
- Every `app/**/page.tsx` and `components/*-form.tsx` / `components/*-run.tsx` — markup/class restyle only.

**Deleted:**
- `components/site-nav.tsx` — replaced by `components/shell/*` (remove after `app-shell` lands and layout no longer imports it).

---

## Phase A — Foundation (branch `feat/ui-phase-a`)

Goal: stylesheets + fonts + app shell + UI primitives + restyled Login. After this phase the whole app is on-brand even before per-page work.

### Task A1: Copy design stylesheets verbatim

**Files:**
- Create: `app/styles/tokens.css`, `app/styles/components.css`, `app/styles/shell.css`, `app/styles/screens.css`

- [ ] **Step 1: Copy the four stylesheets unchanged**

```bash
mkdir -p app/styles
cp /tmp/outreach_design/tokens.css      app/styles/tokens.css
cp /tmp/outreach_design/components.css   app/styles/components.css
cp /tmp/outreach_design/shell.css        app/styles/shell.css
cp /tmp/outreach_design/screens.css      app/styles/screens.css
```

- [ ] **Step 2: In `app/styles/tokens.css`, neutralize the CDN font assumption**

The `--font-sans` / `--font-mono` tokens reference `"Geist"` / `"Geist Mono"` by name (set up via `next/font` in A2). Leave the token values as-is — `next/font` will register those exact family names. No edit needed unless the build warns; if it does, replace the literal family with the `next/font` CSS variable in A2.

- [ ] **Step 3: Verify files are present and parse**

```bash
ls -la app/styles && head -5 app/styles/tokens.css
```
Expected: four files listed; header comment visible.

- [ ] **Step 4: Commit**

```bash
git add app/styles
git commit -m "feat(ui): vendor design-system stylesheets (tokens/components/shell/screens)"
```

### Task A2: Wire fonts + global stylesheet imports in the layout

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Reduce `app/globals.css` to a thin aggregator**

Replace the whole file with imports so a single `globals.css` import pulls everything, in token-first order:

```css
/* Outreach Hub global styles — design-system aggregator. */
@import './styles/tokens.css';
@import './styles/components.css';
@import './styles/shell.css';
@import './styles/screens.css';
```

- [ ] **Step 2: Wire Geist via `next/font/google` and apply the font variables in `app/layout.tsx`**

```tsx
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Geist, Geist_Mono } from 'next/font/google';
import AppShell from '@/components/shell/app-shell';
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata: Metadata = {
  title: 'Outreach Hub',
  description: 'DisplayNote Outreach Hub',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Point the design tokens at the `next/font` variables**

In `app/styles/tokens.css`, change the two font tokens so the loaded fonts are actually used:

```css
  --font-sans: var(--font-geist), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, "SF Mono", "SFMono-Regular", Menlo, Consolas, monospace;
```

- [ ] **Step 4: Temporarily keep the app compiling**

`AppShell` does not exist yet (A3). To keep the tree compiling if you run a check now, you may stub it, but prefer doing A3 next and running checks together. Do NOT commit a broken tree.

- [ ] **Step 5: Commit (after A3 compiles)** — see A3 Step 6.

### Task A3: Build the app shell (server wrapper + client layout)

**Files:**
- Create: `components/shell/nav-config.ts`
- Create: `components/shell/app-shell.tsx` (server)
- Create: `components/shell/app-shell-client.tsx` (client)
- Create: `components/shell/sidebar.tsx` (client)
- Create: `components/shell/topbar.tsx` (client)
- Reference: `components/site-nav.tsx` (current auth pattern), `/tmp/outreach_design/shell.jsx`, `app/styles/shell.css`

- [ ] **Step 1: Write `components/shell/nav-config.ts`**

Mirror the prototype's `NAV` and `SCREEN_TITLES`, mapping to real routes. Keep `/activity` and `/import` reachable by appending them to the Insights group (they are not in the prototype but must not be dropped).

```ts
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
```

- [ ] **Step 2: Write `components/shell/app-shell.tsx` (server)**

Preserve the existing auth pattern from `site-nav.tsx`: when signed out, render children bare (so `/login` has no chrome). Pass real identity into the client shell. Source the queue-due badge count from the same query the queue page uses (reuse, don't invent — read `app/queue/page.tsx` to find the existing query; if it's not cheaply available, pass `null` and the badge renders nothing).

```tsx
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
```

- [ ] **Step 3: Write `components/shell/app-shell-client.tsx` (client)**

Owns collapse + command-palette state; renders `.app` grid from `shell.css`.

```tsx
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
  children,
}: {
  user: ShellUser;
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
      <Sidebar user={user} collapsed={collapsed} />
      <div className="main">
        <Topbar
          user={user}
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
          onOpenCommand={() => setCmdOpen(true)}
        />
        <div className="content">{children}</div>
      </div>
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  );
}
```

- [ ] **Step 4: Write `components/shell/sidebar.tsx` (client)**

Use `usePathname()` for active state. Keep the sign-out as the existing POST form to `/auth/signout`. Use `Icon` from A4 (build A4 first or stub icons inline temporarily — prefer ordering A4 before A3 Step 4; adjust as needed).

```tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_GROUPS } from './nav-config';
import Icon from '@/components/ui/icon';
import type { ShellUser } from './app-shell-client';

export default function Sidebar({
  user,
  collapsed,
}: {
  user: ShellUser;
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
            <div className="sidebar__org">DisplayNote</div>
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
```

Note: the prototype's user dropdown menu (Profile/Settings/Sign out) uses an interactive `Dropdown`. Sign-out MUST remain a real POST form. Keep it simple as above; a dropdown is optional polish, not required.

- [ ] **Step 5: Write `components/shell/topbar.tsx` (client)**

```tsx
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
        className="topbar__collapse"
        onClick={onToggle}
        aria-label="Toggle sidebar"
        title={collapsed ? 'Expand' : 'Collapse'}
      >
        <Icon name="chevronsLeft" size={18} />
      </button>
      <div className="topbar__title">{titleForPath(pathname)}</div>
      <div style={{ flex: 1 }} />
      <button className="topbar__search focusable" onClick={onOpenCommand}>
        <Icon name="search" size={15} />
        <span>Search or jump to…</span>
        <kbd className="kbd">⌘K</kbd>
      </button>
      <div className="sending-as" title={`Sending as ${user.mailbox}`}>
        <span className="sending-as__dot" />
        <Icon name="microsoft" size={13} />
        <span>{user.mailbox.split('@')[0]}</span>
      </div>
    </header>
  );
}
```

- [ ] **Step 6: Run checks and commit A2+A3+A4 together (after A4 done)**

```bash
make typecheck && make lint && make build
```
Expected: all pass. (`AppShell` resolves, fonts compile, no `'use client'`/RSC errors.)

```bash
git add app/layout.tsx app/globals.css app/styles/tokens.css components/shell components/ui
git commit -m "feat(ui): app shell (sidebar+topbar), design tokens, next/font Geist"
```

### Task A4: Port the icon set

**Files:**
- Create: `components/ui/icon.tsx`
- Reference: `/tmp/outreach_design/icons.jsx`

- [ ] **Step 1: Read `icons.jsx` and identify the icons referenced**

The shell + screens reference these names (port at least these): `dashboard, queue, dialler, pipeline, contacts, campaign, sequence, template, suppress, reports, settings, userPlus, search, microsoft, chevronsLeft, chevronDown, logout, phone, mail, check, x, alertCircle, checkCircle, alert, info, zap, inbox, calendar, reply, voicemail, dot`.

- [ ] **Step 2: Write `components/ui/icon.tsx` as a typed inline-SVG map**

Copy each referenced `<svg>` body from `icons.jsx` verbatim into a record. Keep it a plain component (no `'use client'` needed — it renders SVG only).

```tsx
import type { CSSProperties } from 'react';

interface IconProps {
  name: string;
  size?: number;
  strokeWidth?: number;
  style?: CSSProperties;
}

// Paths ported verbatim from the design prototype's icons.jsx.
const PATHS: Record<string, string> = {
  // e.g. search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  // ...fill in every name from Step 1 using the exact path data in icons.jsx
};

export default function Icon({ name, size = 16, strokeWidth = 2, style }: IconProps) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: d }}
    />
  );
}
```

Note: confirm the prototype's `viewBox` and whether icons are stroke- or fill-based; match per icon. If an icon in `icons.jsx` uses `fill`, give it `fill="currentColor"` and `stroke="none"` instead. Do not invent paths — copy them.

- [ ] **Step 3: Typecheck**

```bash
make typecheck
```
Expected: pass.

- [ ] **Step 4: Commit** — folded into A3 Step 6 commit.

### Task A5: Build the UI primitive library

**Files:**
- Create: `components/ui/button.tsx`, `badge.tsx`, `count-badge.tsx`, `avatar.tsx`, `card.tsx`, `pill.tsx`, `empty-state.tsx`, `stat-card.tsx`, `progress-ring.tsx`, `field.tsx`, `index.ts`
- Create: `lib/ui/status.ts`
- Reference: `/tmp/outreach_design/components.jsx`, `app/styles/components.css`

- [ ] **Step 1: Write `components/ui/button.tsx`**

Re-author the prototype `Button` as a typed React component. Default to a real `<button>`; support `as` link usage via a thin wrapper where pages need `<Link>` styled as a button (use `className="btn btn--primary"` directly on `<Link>` in those cases instead).

```tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import Icon from './icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: string;
  iconRight?: string;
  loading?: boolean;
  children?: ReactNode;
}

export default function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  loading = false,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const onlyIcon = icon && !children;
  return (
    <button
      className={`btn btn--${variant} btn--${size} ${onlyIcon ? 'btn--icon' : ''} ${loading ? 'is-loading' : ''} ${className}`.trim()}
      {...rest}
    >
      {loading && <span className="btn__spinner" />}
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {children && <span>{children}</span>}
      {iconRight && <Icon name={iconRight} size={size === 'sm' ? 14 : 16} />}
    </button>
  );
}
```

- [ ] **Step 2: Write the remaining presentational primitives**

Each mirrors its `components.jsx` counterpart's class contract. Keep them server-component-safe (no hooks, no `'use client'`).

`components/ui/badge.tsx`:
```tsx
import type { ReactNode } from 'react';
type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
const TONES: Record<Tone, { fg: string; bg: string }> = {
  neutral: { fg: 'var(--neutral-600)', bg: 'var(--neutral-100)' },
  accent: { fg: 'var(--accent-text)', bg: 'var(--accent-soft)' },
  success: { fg: 'var(--green-700)', bg: 'var(--green-50)' },
  warning: { fg: 'var(--amber-700)', bg: 'var(--amber-50)' },
  danger: { fg: 'var(--red-700)', bg: 'var(--red-50)' },
  info: { fg: 'var(--blue-700)', bg: 'var(--blue-50)' },
};
export default function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  const t = TONES[tone];
  return (
    <span className="pill" style={{ color: t.fg, background: t.bg }}>
      <span className="pill__label">{children}</span>
    </span>
  );
}
```

`components/ui/count-badge.tsx`:
```tsx
import type { ReactNode } from 'react';
export default function CountBadge({ children, tone = 'accent' }: { children: ReactNode; tone?: 'accent' | 'neutral' }) {
  const style =
    tone === 'accent'
      ? { color: '#fff', background: 'var(--accent)' }
      : { color: 'var(--text-secondary)', background: 'var(--bg-muted)' };
  return <span className="badge-count" style={style}>{children}</span>;
}
```

`components/ui/avatar.tsx`:
```tsx
export default function Avatar({ initials, size = 'md' }: { initials: string; size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`avatar avatar--${size}`}>{initials}</span>;
}
```

`components/ui/card.tsx`:
```tsx
import type { CSSProperties, ReactNode } from 'react';
export default function Card({
  title,
  action,
  children,
  bodyStyle,
  className = '',
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  bodyStyle?: CSSProperties;
  className?: string;
}) {
  return (
    <div className={`card ${className}`.trim()}>
      {title && (
        <div className="card__header">
          <div className="card__title">{title}</div>
          {action}
        </div>
      )}
      <div className="card__body" style={bodyStyle}>{children}</div>
    </div>
  );
}
```

`components/ui/empty-state.tsx`:
```tsx
import type { ReactNode } from 'react';
import Icon from './icon';
export default function EmptyState({
  icon = 'inbox',
  title,
  desc,
  action,
}: {
  icon?: string;
  title: string;
  desc?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty__icon"><Icon name={icon} size={22} /></div>
      <div className="empty__title">{title}</div>
      {desc && <div className="empty__desc">{desc}</div>}
      {action && <div style={{ marginTop: 4 }}>{action}</div>}
    </div>
  );
}
```

`components/ui/pill.tsx` (status pill driven by `lib/ui/status.ts`):
```tsx
export interface PillSpec { label: string; fg: string; bg: string; dot: string }
export default function Pill({ spec, withDot = true }: { spec: PillSpec; withDot?: boolean }) {
  return (
    <span className="pill" style={{ color: spec.fg, background: spec.bg }}>
      {withDot && <span className="pill__dot" style={{ background: spec.dot }} />}
      <span className="pill__label">{spec.label}</span>
    </span>
  );
}
```

`components/ui/field.tsx`:
```tsx
import type { ReactNode } from 'react';
import Icon from './icon';
export default function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
}: {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div>
      {label && (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
          {required && <span className="field-req">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <div className="field-error"><Icon name="alertCircle" size={12} />{error}</div>
      ) : hint ? (
        <div className="field-hint">{hint}</div>
      ) : null}
    </div>
  );
}
```

`components/ui/progress-ring.tsx` (used by the dashboard donut goals; pure SVG):
```tsx
export default function ProgressRing({
  value,
  max,
  label,
  caption,
  color = 'var(--accent)',
}: {
  value: number;
  max: number;
  label: string;
  caption?: string;
  color?: string;
}) {
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring">
      <svg width="132" height="132" viewBox="0 0 132 132">
        <circle cx="66" cy="66" r={r} fill="none" stroke="var(--neutral-150)" strokeWidth="12" />
        <circle
          cx="66" cy="66" r={r} fill="none" stroke={color} strokeWidth="12"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)}
          transform="rotate(-90 66 66)"
        />
        <text x="66" y="62" textAnchor="middle" className="ring__value">{label}</text>
        {caption && <text x="66" y="80" textAnchor="middle" className="ring__cap">{caption}</text>}
      </svg>
    </div>
  );
}
```
Note: if `screens.css` lacks `.ring*` classes, add minimal styles in `app/styles/screens.css` (this is the one place new CSS is acceptable; keep it token-based). Verify against `screenshot 02-dashboard.png`.

`components/ui/stat-card.tsx`:
```tsx
import type { ReactNode } from 'react';
import Icon from './icon';
export default function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: string;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="card stat-card">
      <div className="stat-card__head"><Icon name={icon} size={15} />{label}</div>
      <div className="stat-card__value tnum">{value}</div>
      {sub && <div className="stat-card__sub">{sub}</div>}
    </div>
  );
}
```
Note: add `.stat-card*` rules to `screens.css` if absent, matching the dashboard KPI cards.

- [ ] **Step 3: Write `lib/ui/status.ts`**

Map the existing `ContactStatus` union (`none|amber|red|green|meeting|notinterested|bounced` — confirm against `lib/types/domain.ts`) to design pill specs. Pure lookup, no logic.

```ts
import type { ContactStatus } from '@/lib/types/domain';
import type { PillSpec } from '@/components/ui/pill';

export const STATUS_PILLS: Record<ContactStatus, PillSpec> = {
  none: { label: 'No status', fg: 'var(--neutral-600)', bg: 'var(--neutral-100)', dot: 'var(--neutral-400)' },
  amber: { label: 'Warming', fg: 'var(--amber-700)', bg: 'var(--amber-50)', dot: 'var(--amber-500)' },
  red: { label: 'Cold', fg: 'var(--red-700)', bg: 'var(--red-50)', dot: 'var(--red-500)' },
  green: { label: 'Engaged', fg: 'var(--green-700)', bg: 'var(--green-50)', dot: 'var(--green-500)' },
  meeting: { label: 'Meeting booked', fg: 'var(--violet-700)', bg: 'var(--violet-50)', dot: 'var(--violet-500)' },
  notinterested: { label: 'Not interested', fg: 'var(--neutral-600)', bg: 'var(--neutral-100)', dot: 'var(--neutral-500)' },
  bounced: { label: 'Bounced', fg: 'var(--orange-700)', bg: 'var(--orange-50)', dot: 'var(--orange-500)' },
};
```
Important: the **label text** here is presentation. If any existing test asserts a status label string (grep `tests/` for the labels), keep the test's expected string. Otherwise the design labels above apply.

- [ ] **Step 4: Write `components/ui/index.ts` barrel**

```ts
export { default as Button } from './button';
export { default as Badge } from './badge';
export { default as CountBadge } from './count-badge';
export { default as Avatar } from './avatar';
export { default as Card } from './card';
export { default as Pill } from './pill';
export { default as EmptyState } from './empty-state';
export { default as StatCard } from './stat-card';
export { default as ProgressRing } from './progress-ring';
export { default as Field } from './field';
export { default as Icon } from './icon';
```

- [ ] **Step 5: Typecheck + lint + commit**

```bash
make typecheck && make lint
git add components/ui lib/ui app/styles/screens.css
git commit -m "feat(ui): UI primitive library (button/card/pill/badge/avatar/etc.)"
```

### Task A6: Build the command palette (page-navigation only)

**Files:**
- Create: `components/shell/command-palette.tsx`
- Reference: `/tmp/outreach_design/shell.jsx` (CommandPalette), `app/styles/shell.css` (`.cmd*`)

- [ ] **Step 1: Write the palette as nav-only**

Items derive from `NAV_GROUPS`. Selecting an item routes via `next/navigation`'s `useRouter().push`. No free-text search backend.

```tsx
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NAV_GROUPS } from './nav-config';
import Icon from '@/components/ui/icon';

const ITEMS = NAV_GROUPS.flatMap((g) =>
  g.items.map((i) => ({ href: i.href, label: `Go to ${i.label}`, icon: i.icon })),
);

export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(
    () => ITEMS.filter((i) => i.label.toLowerCase().includes(q.toLowerCase())),
    [q],
  );

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
      else if (e.key === 'Enter') {
        const it = filtered[active];
        if (it) { router.push(it.href); onClose(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, filtered, active, onClose, router]);

  if (!open) return null;
  return (
    <div
      className="cmd-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="cmd" role="dialog" aria-modal="true">
        <div className="cmd__input-row">
          <Icon name="search" size={20} style={{ color: 'var(--text-tertiary)' }} />
          <input
            ref={inputRef}
            className="cmd__input"
            placeholder="Jump to a page…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
          />
          <kbd className="kbd">esc</kbd>
        </div>
        <div className="cmd__list">
          {filtered.length === 0 ? (
            <div style={{ padding: 'var(--space-7)', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              No results for &ldquo;{q}&rdquo;
            </div>
          ) : (
            filtered.map((it, i) => (
              <div
                key={it.href}
                className={`cmd__item ${i === active ? 'is-active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => { router.push(it.href); onClose(); }}
              >
                <span className="cmd__item-icon"><Icon name={it.icon} size={17} /></span>
                <span style={{ flex: 1 }}>{it.label}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
make typecheck && make lint
git add components/shell/command-palette.tsx
git commit -m "feat(ui): command palette (page navigation, ⌘K)"
```

### Task A7: Restyle Login + delete old top-nav

**Files:**
- Modify: `app/login/page.tsx`, `app/login/microsoft-sign-in.tsx`
- Delete: `components/site-nav.tsx`
- Reference: `screenshot 01-login.png`, `screen-*`/login markup; e2e `tests/e2e/sanity.spec.ts`

- [ ] **Step 1: Read the current login page + the sanity e2e spec**

```bash
sed -n '1,200p' app/login/page.tsx app/login/microsoft-sign-in.tsx
sed -n '1,40p' tests/e2e/sanity.spec.ts
```
Confirm the strings that must survive: heading `Sign in`, button `Sign in with Microsoft`, dev button `Dev sign-in (mock)`.

- [ ] **Step 2: Restyle login to the split-panel design**

Apply the design's `.login-split` / `.login-brand` layout (left: sign-in card; right: teal brand panel with the "Run a calmer, faster day of outbound." copy and the 45 / 40 / 1-click stats). Keep the dev sign-in button labeled exactly `Dev sign-in (mock)` (NOT the prototype's `Dev sign-in (rachel.okafor@…)`). Keep `Sign in with Microsoft` and the `Sign in` heading verbatim. Add the small responsive `@media (max-width: 880px)` rule from the prototype's inline `<style>` into `app/styles/screens.css`.

- [ ] **Step 3: Remove the obsolete top-nav**

`app/layout.tsx` no longer imports `SiteNav` (it uses `AppShell`). Delete the file:
```bash
git rm components/site-nav.tsx
```

- [ ] **Step 4: Full verification gate**

```bash
make typecheck && make lint && make test && make test-e2e && make build
```
Expected: all green. In particular `tests/e2e/sanity.spec.ts` (Sign in heading + Microsoft button) and the post-login dev flows in `email-runner.spec.ts` / `amd-run.spec.ts` must pass with the new shell.

- [ ] **Step 5: Commit + open PR**

```bash
git add app/login app/layout.tsx
git commit -m "feat(ui): restyle login (split panel); remove legacy top-nav"
git push -u origin feat/ui-phase-a
gh pr create --fill --base main --title "feat(ui): phase A — design foundation, shell, login"
```

---

## Phase B — Outreach hero screens (branch `feat/ui-phase-b`)

Goal: restyle Today, Email Queue (+ runner), Dialler (+ AMD), Pipeline. Each task follows the same shape: read current page → read design reference → swap inline styles for design classes/primitives → preserve test strings → run gate.

### Task B1: Today / Dashboard

**Files:**
- Modify: `app/today/page.tsx`
- Reference: `screenshot 02-dashboard.png`, `08-today.png`, `screen-dashboard.jsx`

- [ ] **Step 1: Read current page + dashboard reference**

```bash
sed -n '1,300p' app/today/page.tsx
sed -n '1,400p' /tmp/outreach_design/screen-dashboard.jsx
```

- [ ] **Step 2: Wrap content and add the page head**

Wrap the page body in `<div className="content__inner">` and add `.page-head` (title `Good morning` greeting + sub line with the real due-count already computed) + `.page-actions` (the existing actions only — do NOT add "Scan inbox"/"Run sender" buttons here unless they already wire to real handlers on this page; those live on the queue page).

- [ ] **Step 3: Replace the inline-styled table with design classes + primitives**

Use `Card` + the design's table classes (`.table`, etc. from `components.css`) for the due-today list. Replace `STATUS_LABELS[contact.status]` rendering with `<Pill spec={STATUS_PILLS[contact.status]} />` from A5 — but FIRST grep tests for status label strings; if `tests/` asserts e.g. `No status`, keep that exact string by adjusting `STATUS_PILLS` labels accordingly. Keep the empty-state via `<EmptyState title="Nothing due today" desc="You're all caught up on follow-ups." />`.

- [ ] **Step 4: Goals/KPI cards — real data only**

If the page already computes goal/KPI numbers, render them with `ProgressRing`/`StatCard`. If a metric shown in the screenshot is NOT computed by the current page (e.g. "Replies today", "Meetings booked"), OMIT it — do not fabricate. (Spec §5.)

- [ ] **Step 5: Gate (touched-page subset + build)**

```bash
make typecheck && make lint && make build
npx playwright test tests/e2e/sanity.spec.ts
```
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add app/today/page.tsx
git commit -m "feat(ui): restyle Today dashboard"
```

### Task B2: Email Queue + runner

**Files:**
- Modify: `app/queue/page.tsx`, `components/email-runner.tsx`
- Reference: `screenshot 03-queue.png`, `04-queue2.png`, `09-queue-rev.png`, `screen-emailqueue.jsx`
- Tests: `tests/e2e/email-runner.spec.ts`

- [ ] **Step 1: Read current files + the e2e spec carefully**

```bash
sed -n '1,400p' app/queue/page.tsx components/email-runner.tsx
sed -n '1,220p' tests/e2e/email-runner.spec.ts
```
List every string the spec asserts (Step at top of plan). These are buttons/labels inside `email-runner.tsx`.

- [ ] **Step 2: Restyle the queue table**

`.content__inner` + `.page-head` (title "Email Queue", sub = real "N due today · sending as <mailbox>"). Render the queue as the design table with `#`, contact, rendered subject, template, step, status columns. Map status to `Badge`/`Pill` (`Ready`→success/neutral, `Bounced`→danger). Use the daily-send-cap bar (`Progress`) ONLY if the page already has the sent/cap numbers.

- [ ] **Step 3: Restyle `email-runner.tsx` controls — preserve ALL test strings**

Convert buttons to `Button` primitive but keep exact text/accessible names: `Run sender now`, `Scan inbox now`, `Simulate inbound (dev)` (card/section), `Sim reply`, `Sim bounce`, and the textbox accessible name `Contact email to simulate inbound from` (keep its `aria-label`/associated `<label>` identical). Do not change the strings the component renders on success (`Sent …`, `Simulated a reply`, `Simulated a bounce`, `… repl…`). Only wrap/restyle.

- [ ] **Step 4: Gate — run the email-runner e2e in full**

```bash
make typecheck && make lint && make build
npx playwright test tests/e2e/email-runner.spec.ts
```
Expected: all assertions pass (sign-in, Run sender now → Sent 2, Sim reply/bounce, Scan inbox now → 1 repl).

- [ ] **Step 5: Commit**

```bash
git add app/queue/page.tsx components/email-runner.tsx
git commit -m "feat(ui): restyle Email Queue + runner controls"
```

### Task B3: Dialler

**Files:**
- Modify: `app/dialler/page.tsx`, `components/click-to-call.tsx`, `components/dialler-run.tsx`
- Reference: `screenshot 01-07-dialler.png`, `02-07-dialler.png`, `screen-dialler.jsx`

- [ ] **Step 1: Read current files + dialler reference**

```bash
sed -n '1,400p' app/dialler/page.tsx components/click-to-call.tsx components/dialler-run.tsx
sed -n '1,500p' /tmp/outreach_design/screen-dialler.jsx
```

- [ ] **Step 2: Two-column layout**

Left: call-queue `Card` with contact rows (avatar, name, status `Pill`, phone, `Call` button — keep click-to-call wiring intact). Right: active-contact `Card` + keypad + "Today's call stats" card (real numbers only; omit any stat not computed). The "Auto voicemail detection" toggle: render the design `Toggle` ONLY if it maps to real existing state; otherwise omit.

- [ ] **Step 3: Preserve click-to-call behavior**

`components/click-to-call.tsx` keeps its existing handlers, guards (double-click protection, unmount safety per recent commits), and any text. Restyle the button to `Button variant="primary" icon="phone"` but keep its accessible name.

- [ ] **Step 4: Gate**

```bash
make typecheck && make lint && make build
```
Expected: pass. (No dialler-specific e2e beyond AMD; run full suite if uncertain.)

- [ ] **Step 5: Commit**

```bash
git add app/dialler/page.tsx components/click-to-call.tsx components/dialler-run.tsx
git commit -m "feat(ui): restyle Dialler (queue + active-call panel)"
```

### Task B4: Dialler AMD run

**Files:**
- Modify: `app/dialler/amd/page.tsx`, `components/amd-run.tsx`
- Reference: `screenshot 01-10-dialler-amd.png`, `02-10-dialler-amd.png`
- Tests: `tests/e2e/amd-run.spec.ts`

- [ ] **Step 1: Read current files + the e2e spec**

```bash
sed -n '1,400p' app/dialler/amd/page.tsx components/amd-run.tsx
sed -n '1,160p' tests/e2e/amd-run.spec.ts
```
Preserve: `Start AMD Run`, `Mock dialler — no real calls placed`, `1 voicemails…`.

- [ ] **Step 2: Restyle AMD run UI**

`.content__inner` + `.page-head`. Wrap controls/results in `Card`s. Keep the AMD reducer-driven live result rendering text identical to what the spec asserts. Convert the start button to `Button` keeping accessible name `Start AMD Run`.

- [ ] **Step 3: Gate — run the AMD e2e in full**

```bash
make typecheck && make lint && make build
npx playwright test tests/e2e/amd-run.spec.ts
```
Expected: pass (sign-in → Mock dialler banner → Start AMD Run → 1 voicemails).

- [ ] **Step 4: Commit**

```bash
git add app/dialler/amd/page.tsx components/amd-run.tsx
git commit -m "feat(ui): restyle Dialler AMD run"
```

### Task B5: Pipeline

**Files:**
- Modify: `app/pipeline/page.tsx`
- Reference: `05-queue3.png` and the contacts/pipeline patterns in `screen-contacts.jsx`

- [ ] **Step 1: Read current page**

```bash
sed -n '1,300p' app/pipeline/page.tsx
```

- [ ] **Step 2: Restyle**

`.content__inner` + `.page-head`. Render the pipeline grouping with `Card`s and status `Pill`s. Real data only.

- [ ] **Step 3: Gate + commit**

```bash
make typecheck && make lint && make build
git add app/pipeline/page.tsx
git commit -m "feat(ui): restyle Pipeline"
```

### Task B6: Phase B full gate + PR

- [ ] **Step 1: Full suite**

```bash
make typecheck && make lint && make test && make test-e2e && make build
```
Expected: all green.

- [ ] **Step 2: Push + PR**

```bash
git push -u origin feat/ui-phase-b
gh pr create --fill --base main --title "feat(ui): phase B — outreach hero screens"
```

---

## Phase C — Data screens (branch `feat/ui-phase-c`)

Goal: Contacts (list/detail/new/edit), Campaigns (+new/edit), Sequences (+new/detail), Templates (+new/edit), Suppressions, Import. Forms are the sensitive part — preserve every `name`, `action`, server-action binding, and `<label>` text.

**General per-form rule (applies to every task in Phase C):** before editing a form, note each `<input name>`, `<label>`, server `action`, and submit-button text. After restyling (wrap inputs in `Field`, use `Button` for submit), diff that those are unchanged. Run `make typecheck && make lint && make build` after each.

### Task C1: Contacts list

**Files:** Modify `app/contacts/page.tsx`. Reference `screenshot 11-contacts-rev.png`, `screen-contacts.jsx`.

- [ ] **Step 1:** Read current page (`sed -n '1,400p' app/contacts/page.tsx`) and the contacts reference.
- [ ] **Step 2:** `.content__inner` + `.page-head` (title "Contacts", action = existing "New contact" link styled `className="btn btn--primary"`). Restyle the list as the design table; status → `Pill`. Preserve any search/filter form `name`/`action` already present. Empty state via `EmptyState`.
- [ ] **Step 3:** `make typecheck && make lint && make build`. Commit `feat(ui): restyle Contacts list`.

### Task C2: Contact detail + status select

**Files:** Modify `app/contacts/[id]/page.tsx`, `app/contacts/[id]/status-select.tsx`. Reference `screen-contacts.jsx` detail.

- [ ] **Step 1:** Read both files + `app/contacts/[id]/actions.ts` (do NOT edit actions; just confirm the wiring you must preserve).
- [ ] **Step 2:** Restyle detail with `Card`s (contact header w/ `Avatar`, status `Pill`, touchpoint timeline). `status-select.tsx` keeps its server-action/`onChange` wiring and option values; only restyle to the design `Select`/segmented control. Preserve option labels if any test asserts them.
- [ ] **Step 3:** `make typecheck && make lint && make build`. Commit `feat(ui): restyle Contact detail`.

### Task C3: Contact new + edit forms

**Files:** Modify `app/contacts/new/page.tsx`, `app/contacts/[id]/edit/page.tsx`, `components/contact-form.tsx`.

- [ ] **Step 1:** Read all three; record every `name`/`label`/`action`/submit text in `contact-form.tsx`.
- [ ] **Step 2:** Wrap fields in `Field` + design `.input`/`.select` classes; submit via `Button variant="primary"`. Keep names/labels/action identical.
- [ ] **Step 3:** `make typecheck && make lint && make build`. Commit `feat(ui): restyle Contact create/edit form`.

### Task C4: Campaigns (list + new + edit + form)

**Files:** Modify `app/campaigns/page.tsx`, `app/campaigns/new/page.tsx`, `app/campaigns/[id]/edit/page.tsx`, `components/campaign-form.tsx`.

- [ ] **Step 1:** Read all four; record form contract.
- [ ] **Step 2:** List → `.page-head` + design table/cards. Forms → `Field`/`Button`, preserving the campaign-form `name`/`action`/labels (note recent commits added `/campaigns` revalidation — do not touch the action).
- [ ] **Step 3:** `make typecheck && make lint && make build`. Commit `feat(ui): restyle Campaigns`.

### Task C5: Sequences (list + new + detail)

**Files:** Modify `app/sequences/page.tsx`, `app/sequences/new/page.tsx`, `app/sequences/[id]/page.tsx`.

- [ ] **Step 1:** Read all three.
- [ ] **Step 2:** Restyle list + detail (step list as `Card` rows with `CountBadge` step numbers). Preserve form contracts.
- [ ] **Step 3:** `make typecheck && make lint && make build`. Commit `feat(ui): restyle Sequences`.

### Task C6: Templates (list + new + edit + form)

**Files:** Modify `app/templates/page.tsx`, `app/templates/new/page.tsx`, `app/templates/[id]/edit/page.tsx`, `components/template-form.tsx`.

- [ ] **Step 1:** Read all four; record form contract.
- [ ] **Step 2:** Restyle list + form. Preserve `name`/`action`/labels and any template-variable preview behavior.
- [ ] **Step 3:** `make typecheck && make lint && make build`. Commit `feat(ui): restyle Templates`.

### Task C7: Suppressions + Import

**Files:** Modify `app/suppressions/page.tsx`, `components/suppression-admin.tsx`, `app/import/page.tsx`, `components/apollo-import-form.tsx`.

- [ ] **Step 1:** Read all four; record form/admin contracts.
- [ ] **Step 2:** Restyle to `.content__inner` + `Card`/table/`Field`. Preserve the suppression-admin action wiring and the apollo-import-form `name`/`action`/labels and any upload input.
- [ ] **Step 3:** `make typecheck && make lint && make build`. Commit `feat(ui): restyle Suppressions + Import`.

### Task C8: Phase C full gate + PR

- [ ] **Step 1:** `make typecheck && make lint && make test && make test-e2e && make build` — all green.
- [ ] **Step 2:** `git push -u origin feat/ui-phase-c && gh pr create --fill --base main --title "feat(ui): phase C — data screens"`.

---

## Phase D — Insights + polish (branch `feat/ui-phase-d`)

Goal: Reports, Activity, Settings, dark-mode toggle, responsive pass.

### Task D1: Reports + Activity

**Files:** Modify `app/reports/page.tsx`, `app/activity/page.tsx`.

- [ ] **Step 1:** Read both pages.
- [ ] **Step 2:** Restyle to `.content__inner` + `.page-head` + `Card`/`StatCard`. Real data only; omit any aspirational metric not computed (use `EmptyState` where a section has no data yet rather than fabricating).
- [ ] **Step 3:** `make typecheck && make lint && make build`. Commit `feat(ui): restyle Reports + Activity`.

### Task D2: Settings

**Files:** Modify `app/settings/page.tsx`, `components/settings-form.tsx`.

- [ ] **Step 1:** Read both; record the settings-form contract (note recent commits restrict org UPDATE to the settings column — do not touch the action/logic).
- [ ] **Step 2:** Restyle with `Field`/`Card`/`Button`, preserving every `name`/`label`/`action`.
- [ ] **Step 3:** `make typecheck && make lint && make build`. Commit `feat(ui): restyle Settings`.

### Task D3: Dark-mode toggle (no FOUC)

**Files:** Create `app/theme-init.tsx`; modify `app/layout.tsx`, `components/shell/topbar.tsx`, `components/shell/app-shell-client.tsx`.

- [ ] **Step 1: Add a pre-paint theme script**

`app/theme-init.tsx` exports an inline `<script>` (via `dangerouslySetInnerHTML`) that reads `localStorage.theme` and sets `document.documentElement.dataset.theme` before paint. Render it in `<head>` of `app/layout.tsx`.

```tsx
export default function ThemeInit() {
  const js = `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.setAttribute('data-theme','dark');}}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
```

- [ ] **Step 2: Add the toggle**

In `topbar.tsx` add a `topbar__icon-btn` with a sun/moon `Icon` that flips `document.documentElement.dataset.theme` and persists to `localStorage`. (Client component already.) `tokens.css` already defines `[data-theme="dark"]`, so no new CSS.

- [ ] **Step 3:** `make typecheck && make lint && make build`; manually verify toggle persists across reload (note in PR). Commit `feat(ui): dark-mode toggle (persisted, no FOUC)`.

### Task D4: Responsive pass

**Files:** Modify `app/styles/shell.css`, `app/styles/screens.css` (media queries only).

- [ ] **Step 1:** Add `@media (max-width: 900px)` rules: collapse sidebar to icons by default / off-canvas, stack two-column screens (dialler, contact detail) to one column. Keep it token-based; no markup changes if avoidable.
- [ ] **Step 2:** `make build`; spot-check at narrow width. Commit `feat(ui): responsive layout pass`.

### Task D5: Phase D full gate + PR

- [ ] **Step 1:** `make typecheck && make lint && make test && make test-e2e && make build` — all green.
- [ ] **Step 2:** `git push -u origin feat/ui-phase-d && gh pr create --fill --base main --title "feat(ui): phase D — insights, dark mode, responsive"`.

---

## Final acceptance checklist

- [ ] All four phase PRs merged to `main`, each with green CI.
- [ ] `make typecheck && make lint && make test && make test-e2e && make build` green on `main`.
- [ ] No changes under `lib/`, `app/**/actions.ts`, `app/api/**`, `app/auth/**` (verify with `git diff --stat main..` per PR — only presentation files changed).
- [ ] No fabricated metrics: every number shown is backed by real data or omitted.
- [ ] All §5 test-coupled strings intact (grep confirms).
- [ ] `components/site-nav.tsx` deleted; `components/shell/*` is the only nav.
