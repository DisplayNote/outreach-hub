import type { ButtonHTMLAttributes, ReactNode } from 'react';
import Icon from './icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

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
  children,
  ...rest
}: ButtonProps) {
  const onlyIcon = icon && !children;
  return (
    <button
      className={`btn btn--${variant} btn--${size} ${onlyIcon ? 'btn--icon' : ''} ${loading ? 'is-loading' : ''} ${className}`.trim()}
      {...rest}
    >
      {loading && <span className="btn__spinner" />}
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {children && <span>{children}</span>}
      {iconRight && <Icon name={iconRight} size={size === 'sm' ? 14 : 16} />}
    </button>
  );
}
