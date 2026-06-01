import type { ReactNode } from 'react';

export default function CountBadge({
  children,
  tone = 'accent',
}: {
  children: ReactNode;
  tone?: 'accent' | 'neutral';
}) {
  const style =
    tone === 'accent'
      ? { color: '#fff', background: 'var(--accent)' }
      : { color: 'var(--text-secondary)', background: 'var(--bg-muted)' };
  return (
    <span className="badge-count" style={style}>
      {children}
    </span>
  );
}
