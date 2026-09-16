'use client';

import { ArrowDownRight, ArrowRight, ArrowUpRight, Database, Percent, TrendingUp, Wallet } from 'lucide-react';
import { formatDelta, formatFull, formatValue } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Kpi } from '@/types/api';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  currency: Wallet,
  percent: Percent,
  database: Database,
  'trending-up': TrendingUp,
};

/**
 * The hero-number form: when the story is one value, that value *is* the chart.
 * The delta carries an arrow and a text label, so direction never depends on
 * colour alone.
 */
export function KpiCard({
  kpi,
  accent = 'primary',
  compact = false,
  className,
}: {
  kpi: Kpi & { icon?: string };
  accent?: string;
  compact?: boolean;
  className?: string;
}) {
  const Icon = ICONS[kpi.icon ?? ''] ?? TrendingUp;
  const delta = kpi.delta;

  const direction = delta?.direction ?? 'flat';
  const DeltaIcon =
    direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : ArrowRight;
  const deltaTone =
    direction === 'up'
      ? 'text-positive bg-positive/10'
      : direction === 'down'
        ? 'text-negative bg-negative/10'
        : 'text-ink-muted bg-surface-sunken';

  return (
    <div className={cn('flex h-full flex-col justify-between gap-3', compact ? 'p-4' : 'p-5', className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 truncate text-[13px] font-medium text-ink-muted" title={kpi.label}>
          {kpi.label}
        </p>
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
          style={{
            backgroundColor: `rgb(var(--color-${accent}) / 0.12)`,
            color: `rgb(var(--color-${accent}))`,
          }}
          aria-hidden
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
      </div>

      <div className="min-w-0">
        <p
          className="truncate text-[28px] font-semibold leading-none tracking-[-0.03em] tabular-nums"
          title={formatFull(kpi.value, kpi.format === 'integer' ? 'decimal' : kpi.format)}
        >
          {formatValue(kpi.value, kpi.format, { compact: true })}
        </p>

        {delta && (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded-sm px-1.5 py-0.5 text-xs font-semibold tabular-nums',
                deltaTone,
              )}
            >
              <DeltaIcon className="h-3 w-3" aria-hidden />
              {formatDelta(delta.value)}
            </span>
            <span className="truncate text-xs text-ink-subtle" title={`${delta.current_period} vs ${delta.previous_period}`}>
              {delta.label}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
