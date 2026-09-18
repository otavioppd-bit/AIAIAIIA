'use client';

import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { formatDelta, formatFull, formatValue } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Kpi } from '@/types/api';

/**
 * The hero-number form: when the story is one value, that value *is* the chart.
 *
 * Direction is carried by the arrow and the text, never by hue — a reader who
 * cannot separate red from green loses nothing here, and the panel keeps the
 * near-zero colourfulness the rest of the system holds to.
 */
export function KpiCard({
  kpi,
  compact = false,
  pending = false,
  className,
}: {
  kpi: Kpi & { icon?: string };
  /** Accepted for spec compatibility; the blueprint KPI carries no accent fill. */
  accent?: string;
  compact?: boolean;
  /** A recomputation is in flight; the figure shown is the previous one. */
  pending?: boolean;
  className?: string;
}) {
  const delta = kpi.delta;
  const direction = delta?.direction ?? 'flat';
  const DeltaIcon =
    direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : ArrowRight;

  return (
    <div
      className={cn(
        'flex h-full flex-col justify-between gap-4',
        compact ? 'p-4' : 'px-5 py-4',
        className,
      )}
    >
      <div className="min-w-0">
        <p className="mono-label truncate text-[10px] text-ink-subtle" title={kpi.label}>
          {kpi.label}
        </p>
        <div className="rule-dashed mt-2 opacity-60" />
      </div>

      <div className="min-w-0">
        <p
          className={cn(
            'numeric font-extrabold leading-none text-ink transition-opacity duration-200',
            pending && 'opacity-40',
            kpiValueSize(formatValue(kpi.value, kpi.format, { compact: true })),
          )}
          title={formatFull(kpi.value, kpi.format === 'integer' ? 'decimal' : kpi.format)}
        >
          {formatValue(kpi.value, kpi.format, { compact: true })}
        </p>

        {delta && (
          <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span
              className={cn(
                'numeric inline-flex items-center gap-1 text-caption font-semibold',
                direction === 'flat' ? 'text-ink-subtle' : 'text-ink',
              )}
            >
              <DeltaIcon className="h-3 w-3 text-primary" aria-hidden />
              {formatDelta(delta.value)}
            </span>
            <span
              className="truncate text-caption text-ink-subtle"
              title={`${delta.current_period} vs ${delta.previous_period}`}
            >
              {delta.label}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A clipped figure is worse than a small one: "R$ 728.5…" is not a number the
 * reader can act on. So a long value steps down through the scale instead of
 * meeting an ellipsis, and the card never truncates what it exists to show.
 */
function kpiValueSize(text: string): string {
  if (text.length > 14) return 'text-[22px]';
  if (text.length > 11) return 'text-[26px]';
  if (text.length > 8) return 'text-[30px]';
  return 'text-[34px]';
}
