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
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring">
      <svg width="132" height="132" viewBox="0 0 132 132">
        <circle cx="66" cy="66" r={r} fill="none" stroke="var(--neutral-150)" strokeWidth="12" />
        <circle
          cx="66"
          cy="66"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          transform="rotate(-90 66 66)"
        />
        <text x="66" y="62" textAnchor="middle" className="ring__value">
          {label}
        </text>
        {caption && (
          <text x="66" y="80" textAnchor="middle" className="ring__cap">
            {caption}
          </text>
        )}
      </svg>
    </div>
  );
}
