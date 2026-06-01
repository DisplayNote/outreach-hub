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
      <div className="card__body" style={bodyStyle}>
        {children}
      </div>
    </div>
  );
}
