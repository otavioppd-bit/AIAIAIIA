'use client';

import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { formatDelta, formatFull, formatValue } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Insight, Kpi } from '@/types/api';

interface InsightHeroProps {
  /** Ranked by the analysis engine; the first is the headline finding. */
  insights: Insight[];
  headline?: Kpi;
  domain?: { label: string; description: string } | null;
  className?: string;
}

/**
 * The finding, stated once and stated large.
 *
 * A grid of equally weighted cards asks the reader to work out what matters; a
 * dashboard that has already done the analysis should be willing to say so. The
 * engine ranks insights by importance, and this band spends real space on the
 * first one — the headline number beside it, the supporting findings reduced to
 * a line each underneath.
 */
export function InsightHero({ insights, headline, domain, className }: InsightHeroProps) {
  const [lead, ...rest] = insights;
  if (!lead && !headline) return null;

  const direction = headline?.delta?.direction ?? 'flat';
  const DeltaIcon =
    direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : ArrowRight;

  return (
    <section
      className={cn('relative border-y border-line/80 py-8 sm:py-10', className)}
      aria-label="Principal descoberta"
    >
      <div className="grid gap-8 lg:grid-cols-[1.35fr_0.65fr] lg:gap-12">
        <div className="min-w-0">
          <p className="eyebrow text-primary">
            {domain?.label ? `Análise · ${domain.label}` : 'Principal descoberta'}
          </p>

          {lead && (
            <>
              <h2 className="display mt-4 text-[28px] text-ink sm:text-[38px]">{lead.title}</h2>
              <p className="mt-4 max-w-2xl text-body-sm leading-relaxed text-ink-muted">
                {lead.description}
              </p>
              {lead.columns.length > 0 && (
                <p className="mono-label mt-4 text-[10px] text-ink-subtle">
                  Apurado em {lead.columns.slice(0, 3).join(' · ')}
                </p>
              )}
            </>
          )}
        </div>

        {headline && (
          <div className="min-w-0 border-t border-dashed border-line-strong/50 pt-6 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
            <p className="mono-label text-[10px] text-ink-subtle">{headline.label}</p>
            <p
              className={cn(
                'numeric mt-3 font-extrabold leading-none',
                heroValueSize(formatValue(headline.value, headline.format, { compact: true })),
              )}
              title={formatFull(headline.value, headline.format === 'integer' ? 'decimal' : headline.format)}
            >
              {formatValue(headline.value, headline.format, { compact: true })}
            </p>
            {headline.delta && (
              <p className="numeric mt-3 flex items-center gap-1.5 text-body-sm text-ink">
                <DeltaIcon className="h-3.5 w-3.5 text-primary" aria-hidden />
                {formatDelta(headline.delta.value)}
                <span className="text-caption text-ink-subtle">{headline.delta.label}</span>
              </p>
            )}
          </div>
        )}
      </div>

      {rest.length > 0 && (
        <ul className="mt-8 grid gap-x-8 gap-y-3 border-t border-dashed border-line-strong/40 pt-6 sm:grid-cols-2 lg:grid-cols-3">
          {rest.slice(0, 3).map((insight) => (
            <li key={insight.title} className="flex gap-3">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden />
              <div className="min-w-0">
                <p className="text-body-sm font-medium leading-snug text-ink">{insight.title}</p>
                <p className="mt-1 line-clamp-2 text-caption leading-relaxed text-ink-subtle">
                  {insight.description}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Same rule as the KPI card: step the scale down rather than clip a figure. */
function heroValueSize(text: string): string {
  if (text.length > 14) return 'text-[30px] sm:text-[36px]';
  if (text.length > 11) return 'text-[34px] sm:text-[42px]';
  return 'text-[40px] sm:text-[52px]';
}
