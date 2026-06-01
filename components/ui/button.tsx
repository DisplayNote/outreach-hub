import type { ButtonHTMLAttributes, ReactNode } from 'react';
import Icon from './icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

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
  disabled,
  children,
  ...rest
}: ButtonProps) {
  // Treat 0 and '' as real children; only null/undefined/false count as absent
  // (a truthiness test would drop a valid 0 node and miscompute onlyIcon).
  const hasChildren = children !== null && children !== undefined && children !== false;
  const onlyIcon = icon && !hasChildren;
  // A loading button is busy: disable it (so it can't be activated by mouse or
  // keyboard) and expose the busy state to assistive tech.
  return (
    <button
      className={`btn btn--${variant} btn--${size} ${onlyIcon ? 'btn--icon' : ''} ${loading ? 'is-loading' : ''} ${className}`.trim()}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="btn__spinner" />}
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {hasChildren && <span>{children}</span>}
      {iconRight && <Icon name={iconRight} size={size === 'sm' ? 14 : 16} />}
    </button>
  );
}
