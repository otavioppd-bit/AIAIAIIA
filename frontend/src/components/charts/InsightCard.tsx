'use client';

import { useState } from 'react';
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, ChevronDown,
  GitCompare, Layers, Minus, PieChart, Sparkles, TrendingDown, TrendingUp, Trophy,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Insight } from '@/types/api';

const KIND_META: Record<
  Insight['kind'],
  { icon: React.ComponentType<{ className?: string }>; label: string }
> = {
  trend: { icon: TrendingUp, label: 'Tendência' },
  anomaly: { icon: AlertTriangle, label: 'Anomalia' },
  concentration: { icon: Layers, label: 'Concentração' },
  correlation: { icon: GitCompare, label: 'Correlação' },
  quality: { icon: Sparkles, label: 'Qualidade' },
  distribution: { icon: BarChart3, label: 'Distribuição' },
  composition: { icon: PieChart, label: 'Composição' },
  ranking: { icon: Trophy, label: 'Ranking' },
};

/**
 * Direction-aware icon variants for the two kinds whose sentiment maps
 * directly onto "up" / "down" / "flat". The backend never bakes a pictograph
 * into the title string; this icon is the only visual carrier of direction.
 */
function resolveIcon(insight: Insight): React.ComponentType<{ className?: string }> {
  if (insight.kind === 'trend') {
    if (insight.sentiment === 'positive') return TrendingUp;
    if (insight.sentiment === 'negative') return TrendingDown;
    return Minus;
  }
  if (insight.kind === 'anomaly') {
    return insight.sentiment === 'negative' ? ArrowDownRight : ArrowUpRight;
  }
  return KIND_META[insight.kind]?.icon ?? KIND_META.trend.icon;
}

const SENTIMENT_STYLES = {
  positive: 'border-l-positive',
  negative: 'border-l-negative',
  neutral: 'border-l-primary',
} as const;

/**
 * Every insight carries the evidence that produced it — the columns, the
 * numbers and the statistical method — so a reader can verify the claim
 * instead of trusting it.
 */
export function InsightCard({ insight, className }: { insight: Insight; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const meta = KIND_META[insight.kind] ?? KIND_META.trend;
  const Icon = resolveIcon(insight);
  const method = insight.evidence?.method as string | undefined;
  const hasEvidence = Boolean(method) || insight.columns.length > 0;

  return (
    <article
      className={cn(
        'group rounded-lg border border-l-2 border-line bg-surface p-4 transition-all duration-200',
        'hover:border-line-strong hover:shadow-sm',
        SENTIMENT_STYLES[insight.sentiment],
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
            insight.sentiment === 'positive' && 'bg-positive/10 text-positive',
            insight.sentiment === 'negative' && 'bg-negative/10 text-negative',
            insight.sentiment === 'neutral' && 'bg-primary-soft text-primary',
          )}
          aria-hidden
        >
          <Icon className="h-3.5 w-3.5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h4 className="text-[13.5px] font-semibold leading-snug tracking-[-0.01em]">{insight.title}</h4>
            <span className="mt-0.5 shrink-0 text-2xs font-medium uppercase tracking-wide text-ink-subtle">
              {meta.label}
            </span>
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">{insight.description}</p>

          {hasEvidence && (
            <>
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-ink-subtle transition-colors hover:text-primary"
                aria-expanded={expanded}
              >
                Como calculamos
                <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
              </button>

              {expanded && (
                <div className="mt-2 animate-fade-in space-y-1.5 rounded-md bg-surface-sunken p-2.5 text-xs">
                  {method && (
                    <p className="text-ink-muted">
                      <span className="font-medium text-ink">Método:</span> {method}
                    </p>
                  )}
                  {insight.columns.length > 0 && (
                    <p className="text-ink-muted">
                      <span className="font-medium text-ink">Colunas:</span>{' '}
                      <span className="font-mono">{insight.columns.join(', ')}</span>
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </article>
  );
}
