'use client';

import { useId } from 'react';
import { cn } from '@/lib/utils';

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3">
      {(label || description) && (
        <label htmlFor={id} className="min-w-0 cursor-pointer select-none">
          {label && <span className="block text-[13px] font-medium text-ink">{label}</span>}
          {description && <span className="mt-0.5 block text-xs text-ink-subtle">{description}</span>}
        </label>
      )}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200',
          checked ? 'bg-primary' : 'bg-line-strong',
          disabled && 'pointer-events-none opacity-50',
        )}
      >
        <span
          className={cn(
            'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-smooth',
            checked ? 'translate-x-[18px]' : 'translate-x-[3px]',
          )}
        />
      </button>
    </div>
  );
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  formatValue,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  formatValue?: (value: number) => string;
}) {
  const id = useId();
  const percent = ((value - min) / (max - min)) * 100;
  return (
    <div className="w-full">
      {label && (
        <div className="mb-1.5 flex items-center justify-between">
          <label htmlFor={id} className="text-[13px] font-medium text-ink-muted">
            {label}
          </label>
          <span className="text-xs tabular-nums text-ink-subtle">
            {formatValue ? formatValue(value) : value}
          </span>
        </div>
      )}
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none
          [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-sm
          [&::-webkit-slider-thumb]:transition-transform hover:[&::-webkit-slider-thumb]:scale-110
          [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full
          [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary"
        style={{
          background: `linear-gradient(to right, rgb(var(--color-primary)) ${percent}%, rgb(var(--color-line-strong)) ${percent}%)`,
        }}
      />
    </div>
  );
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  className?: string;
}) {
  return (
    <div className={cn('inline-flex rounded-md border border-line bg-surface-sunken p-0.5', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          title={option.label}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-xs font-medium transition-all duration-150',
            option.value === value
              ? 'bg-surface text-ink shadow-xs'
              : 'text-ink-subtle hover:text-ink-muted',
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

const SWATCHES = [
  { token: 'primary', label: 'Primária' },
  { token: 'violet', label: 'Violeta' },
  { token: 'teal', label: 'Turquesa' },
  { token: 'amber', label: 'Âmbar' },
  { token: 'rose', label: 'Rosa' },
  { token: 'sky', label: 'Azul-céu' },
];

export function AccentPicker({
  value,
  onChange,
  label = 'Cor de destaque',
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  return (
    <div>
      <span className="mb-2 block text-[13px] font-medium text-ink-muted">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {SWATCHES.map((swatch) => (
          <button
            key={swatch.token}
            type="button"
            onClick={() => onChange(swatch.token)}
            aria-label={swatch.label}
            aria-pressed={value === swatch.token}
            title={swatch.label}
            className={cn(
              'h-7 w-7 rounded-md border-2 transition-all duration-150',
              value === swatch.token
                ? 'border-ink scale-105'
                : 'border-transparent hover:scale-105',
            )}
            style={{ backgroundColor: `rgb(var(--color-${swatch.token}))` }}
          />
        ))}
      </div>
    </div>
  );
}

export function Progress({
  value,
  className,
  tone = 'primary',
}: {
  value: number;
  className?: string;
  tone?: 'primary' | 'positive' | 'warning' | 'negative';
}) {
  const clamped = Math.min(Math.max(value, 0), 100);
  const colors = {
    primary: 'bg-primary',
    positive: 'bg-positive',
    warning: 'bg-warning',
    negative: 'bg-negative',
  };
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken', className)}
    >
      <div
        className={cn('h-full rounded-full transition-all duration-500 ease-smooth', colors[tone])}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
