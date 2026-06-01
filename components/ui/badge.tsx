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
