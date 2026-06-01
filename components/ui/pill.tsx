export interface PillSpec {
  label: string;
  fg: string;
  bg: string;
  dot: string;
}

export default function Pill({ spec, withDot = true }: { spec: PillSpec; withDot?: boolean }) {
  return (
    <span className="pill" style={{ color: spec.fg, background: spec.bg }}>
      {withDot && <span className="pill__dot" style={{ background: spec.dot }} />}
      <span className="pill__label">{spec.label}</span>
    </span>
  );
}
