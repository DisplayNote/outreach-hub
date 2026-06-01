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
      <div className="stat-card__head">
        <Icon name={icon} size={15} />
        {label}
      </div>
      <div className="stat-card__value tnum">{value}</div>
      {sub && <div className="stat-card__sub">{sub}</div>}
    </div>
  );
}
