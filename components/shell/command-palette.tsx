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

  // State reset on open is handled by the `key` remount in app-shell-client.tsx,
  // which avoids the react-hooks/set-state-in-effect lint rule. This effect only
  // manages focus.
  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      // Minimal focus trap: keep focus on the input (arrow keys drive list
      // navigation), so Tab can't move focus behind the modal overlay.
      else if (e.key === 'Tab') { e.preventDefault(); inputRef.current?.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, Math.max(0, filtered.length - 1))); }
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
      <div className="cmd" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="cmd__input-row">
          <Icon name="search" size={20} style={{ color: 'var(--text-tertiary)' }} />
          <input
            ref={inputRef}
            className="cmd__input"
            aria-label="Jump to a page"
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
              <button
                type="button"
                key={it.href}
                className={`cmd__item ${i === active ? 'is-active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => { router.push(it.href); onClose(); }}
              >
                <span className="cmd__item-icon"><Icon name={it.icon} size={17} /></span>
                <span style={{ flex: 1 }}>{it.label}</span>
              </button>
            ))
          )}
        </div>
        <div className="cmd__foot">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd> navigate
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <kbd className="kbd">↵</kbd> select
          </span>
        </div>
      </div>
    </div>
  );
}
