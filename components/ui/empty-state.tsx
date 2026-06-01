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
      <div className="empty__icon">
        <Icon name={icon} size={22} />
      </div>
      <div className="empty__title">{title}</div>
      {desc && <div className="empty__desc">{desc}</div>}
      {action && <div style={{ marginTop: 4 }}>{action}</div>}
    </div>
  );
}
