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
    if (!open) return undefined;
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
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
