import type { ReactNode } from 'react';
import Icon from './icon';

export default function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
}: {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div>
      {label && (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
          {required && (
            <span className="field-req" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      {children}
      {error ? (
        <div className="field-error">
          <Icon name="alertCircle" size={12} />
          {error}
        </div>
      ) : hint ? (
        <div className="field-hint">{hint}</div>
      ) : null}
    </div>
  );
}
