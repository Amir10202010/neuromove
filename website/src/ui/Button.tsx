import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid' | 'demo';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
  block?: boolean;
  iconOnly?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  loading,
  block,
  iconOnly,
  className,
  children,
  type = 'button',
  disabled,
  ...rest
}: ButtonProps) {
  const cls = [
    'btn',
    `btn--${variant}`,
    size !== 'md' && `btn--${size}`,
    block && 'btn--block',
    iconOnly && 'btn--icon',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <LoaderCircle className="spinner" aria-hidden /> : icon}
      {children}
      {iconRight}
    </button>
  );
}

/** Ссылка, которая выглядит как кнопка — для переходов между экранами. */
export function LinkButton({
  href,
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  children,
  className,
  onClick,
  ...rest
}: {
  href: string;
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  iconRight?: ReactNode;
  children?: ReactNode;
  className?: string;
  onClick?: () => void;
  'aria-label'?: string;
}) {
  const cls = ['btn', `btn--${variant}`, size !== 'md' && `btn--${size}`, className].filter(Boolean).join(' ');
  return (
    <a href={href} className={cls} onClick={onClick} style={{ textDecoration: 'none' }} {...rest}>
      {icon}
      {children}
      {iconRight}
    </a>
  );
}
