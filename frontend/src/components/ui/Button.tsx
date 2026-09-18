'use client';

import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'subtle';
type Size = 'xs' | 'sm' | 'md' | 'lg';

/*
 * A button here is the wireframe of a button: an outlined pill, never a fill.
 * Hierarchy comes from the weight of the stroke, and the primary action earns
 * its emphasis by inverting on hover rather than by sitting there filled.
 */
const VARIANTS: Record<Variant, string> = {
  primary:
    'border border-ink text-ink hover:bg-ink hover:text-canvas active:brightness-90',
  secondary:
    'border border-line-strong/70 text-ink hover:border-ink hover:bg-ink/5',
  outline: 'border border-line text-ink-muted hover:text-ink hover:border-line-strong',
  ghost: 'text-ink-muted hover:text-ink hover:bg-ink/5',
  subtle: 'border border-primary/45 text-primary hover:border-primary hover:bg-primary/10',
  danger: 'border border-negative text-negative hover:bg-negative hover:text-canvas',
};

const SIZES: Record<Size, string> = {
  xs: 'h-7 px-3 text-xs gap-1.5 rounded-pill',
  sm: 'h-8 px-3.5 text-[13px] gap-1.5 rounded-pill',
  md: 'h-9 px-4 text-sm gap-2 rounded-pill',
  lg: 'h-11 px-6 text-[15px] gap-2.5 rounded-pill',
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
