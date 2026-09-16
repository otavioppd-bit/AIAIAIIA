'use client';

import { useState } from 'react';
import { Check, Filter as FilterIcon, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format';
import type { DashboardFilter } from '@/types/api';

interface FilterBarProps {
  filters: DashboardFilter[];
  onChange: (filterId: string, value: unknown) => void;
  onReset: () => void;
  className?: string;
}

/** Filters live in one row above the charts, per the interaction spec. */
export function FilterBar({ filters, onChange, onReset, className }: FilterBarProps) {
  if (filters.length === 0) return null;

  const activeCount = filters.filter((filter) => {
    if (Array.isArray(filter.value)) return filter.value.filter(Boolean).length > 0;
    return filter.value !== null && filter.value !== undefined && filter.value !== '';
  }).length;

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-subtle">
        <FilterIcon className="h-3.5 w-3.5" />
        Filtros
      </span>

      {filters.map((filter) =>
        filter.kind === 'multi_select' ? (
          <MultiSelectFilter key={filter.id} filter={filter} onChange={onChange} />
        ) : (
          <DateRangeFilter key={filter.id} filter={filter} onChange={onChange} />
        ),
      )}

      {activeCount > 0 && (
        <Button variant="ghost" size="xs" icon={<RotateCcw className="h-3 w-3" />} onClick={onReset}>
          Limpar ({activeCount})
        </Button>
      )}
    </div>
  );
}

function MultiSelectFilter({
  filter,
  onChange,
}: {
  filter: DashboardFilter;
  onChange: (id: string, value: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = Array.isArray(filter.value) ? (filter.value as string[]) : [];
  const options = filter.options ?? [];

  const toggle = (option: string) => {
    const next = selected.includes(option)
      ? selected.filter((value) => value !== option)
      : [...selected, option];
    onChange(filter.id, next);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-all',
          selected.length > 0
            ? 'border-primary/40 bg-primary-soft text-primary'
            : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
        )}
      >
        {filter.label}
        {selected.length > 0 && (
          <span className="rounded-sm bg-primary px-1 text-2xs text-primary-ink">{selected.length}</span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute left-0 top-9 z-30 max-h-64 w-56 animate-scale-in overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-lg">
            {options.length === 0 ? (
              <p className="p-3 text-xs text-ink-subtle">Nenhum valor disponível.</p>
            ) : (
              options.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => toggle(option)}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs
                    text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink"
                >
                  <span className="truncate">{option}</span>
                  {selected.includes(option) && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                </button>
              ))
            )}
            {selected.length > 0 && (
              <button
                type="button"
                onClick={() => onChange(filter.id, [])}
                className="mt-1 flex w-full items-center gap-1.5 border-t border-line px-2 py-1.5 text-xs text-ink-subtle hover:text-negative"
              >
                <X className="h-3 w-3" />
                Limpar seleção
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function DateRangeFilter({
  filter,
  onChange,
}: {
  filter: DashboardFilter;
  onChange: (id: string, value: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const range = Array.isArray(filter.value) ? (filter.value as [string, string]) : ['', ''];
  const active = Boolean(range[0] || range[1]);

  const toDateInput = (value: unknown): string => {
    if (!value) return '';
    const text = String(value);
    return text.length >= 10 ? text.slice(0, 10) : text;
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-all',
          active
            ? 'border-primary/40 bg-primary-soft text-primary'
            : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
        )}
      >
        {filter.label}
        {active && (
          <span className="tabular-nums">
            {range[0] ? formatDate(range[0]) : '…'} – {range[1] ? formatDate(range[1]) : '…'}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute left-0 top-9 z-30 w-64 animate-scale-in rounded-lg border border-line bg-surface p-3 shadow-lg">
            <label className="block text-2xs font-medium uppercase tracking-wide text-ink-subtle">
              De
              <input
                type="date"
                value={range[0] ?? ''}
                min={toDateInput(filter.min)}
                max={toDateInput(filter.max)}
                onChange={(event) => onChange(filter.id, [event.target.value, range[1] ?? ''])}
                className="mt-1 h-8 w-full rounded-md border border-line bg-surface-sunken px-2 text-xs text-ink outline-none focus:border-primary"
              />
            </label>
            <label className="mt-2 block text-2xs font-medium uppercase tracking-wide text-ink-subtle">
              Até
              <input
                type="date"
                value={range[1] ?? ''}
                min={toDateInput(filter.min)}
                max={toDateInput(filter.max)}
                onChange={(event) => onChange(filter.id, [range[0] ?? '', event.target.value])}
                className="mt-1 h-8 w-full rounded-md border border-line bg-surface-sunken px-2 text-xs text-ink outline-none focus:border-primary"
              />
            </label>
            {active && (
              <button
                type="button"
                onClick={() => onChange(filter.id, null)}
                className="mt-2 w-full rounded-md py-1 text-xs text-ink-subtle hover:text-negative"
              >
                Limpar período
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
