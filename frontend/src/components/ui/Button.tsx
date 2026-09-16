'use client';

import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'subtle';
type Size = 'xs' | 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-primary text-primary-ink hover:brightness-110 active:brightness-95 shadow-sm',
  secondary:
    'bg-surface-raised text-ink border border-line hover:border-line-strong hover:bg-surface',
  outline: 'border border-line text-ink hover:bg-surface-raised hover:border-line-strong',
  ghost: 'text-ink-muted hover:text-ink hover:bg-surface-raised',
  subtle: 'bg-primary-soft text-primary hover:brightness-105',
  danger: 'bg-negative text-white hover:brightness-110',
};

const SIZES: Record<Size, string> = {
  xs: 'h-7 px-2.5 text-xs gap-1.5 rounded-sm',
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-md',
  md: 'h-10 px-4 text-sm gap-2 rounded-md',
  lg: 'h-12 px-6 text-[15px] gap-2.5 rounded-lg',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'primary',
    size = 'md',
    loading = false,
    icon,
    iconRight,
    fullWidth,
    disabled,
    children,
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'relative inline-flex select-none items-center justify-center whitespace-nowrap font-medium',
        'transition-all duration-150 ease-smooth',
        'disabled:pointer-events-none disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
      ) : (
        icon
      )}
      {children}
      {!loading && iconRight}
    </button>
  );
});

export function IconButton({
  className,
  label,
  size = 'md',
  variant = 'ghost',
  ...props
}: Omit<ButtonProps, 'children' | 'icon'> & { label: string; children?: React.ReactNode }) {
  const dimensions = { xs: 'h-6 w-6', sm: 'h-7 w-7', md: 'h-9 w-9', lg: 'h-11 w-11' }[size];
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md transition-all duration-150',
        'disabled:pointer-events-none disabled:opacity-45',
        VARIANTS[variant],
        dimensions,
        className,
      )}
      {...props}
    />
  );
}
