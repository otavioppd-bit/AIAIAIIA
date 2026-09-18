'use client';

import { forwardRef, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Logo } from './Logo';
import { ThemePicker } from './ThemePicker';
import { UserMenu } from './UserMenu';
import { BackgroundField, type FieldVariant } from '@/components/background/BackgroundField';
import { cn } from '@/lib/utils';
import { formatInteger } from '@/lib/format';
import type { DatasetDetail } from '@/types/api';

/**
 * Navigation is a line of labels, not a panel. A sidebar spends 224px of every
 * screen on wayfinding the user needs for one second; the data gets that space
 * back here.
 */
const NAV_ITEMS = [
  { segment: 'overview', label: 'Overview' },
  { segment: 'analytics', label: 'Analytics' },
  { segment: 'explore', label: 'Explore' },
  { segment: 'analyst', label: 'AI Analyst' },
  { segment: 'quality', label: 'Data Quality' },
  { segment: 'customize', label: 'Customize' },
  { segment: 'reports', label: 'Reports' },
] as const;

/** Each screen sits on the field variant that matches what it is for. */
const FIELD_BY_SEGMENT: Record<string, FieldVariant> = {
  overview: 'dashboard',
  analytics: 'dashboard',
  explore: 'dashboard',
  analyst: 'analyst',
  quality: 'quality',
  customize: 'dashboard',
  reports: 'dashboard',
};

interface DatasetShellProps {
  dataset: DatasetDetail;
  children: React.ReactNode;
  actions?: React.ReactNode;
}

export function DatasetShell({ dataset, children, actions }: DatasetShellProps) {
  const pathname = usePathname();
  const navRef = useRef<HTMLUListElement>(null);

  const base = `/app/datasets/${dataset.id}`;
  const activeSegment =
    NAV_ITEMS.find((item) => pathname?.startsWith(`${base}/${item.segment}`))?.segment ?? 'overview';

  // On a narrow viewport the rail scrolls; the current screen has to be in view.
  useEffect(() => {
    const active = navRef.current?.querySelector('[aria-current="page"]');
    active?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [activeSegment]);

  return (
    <div className="relative flex min-h-screen flex-col bg-canvas">
      <BackgroundField variant={FIELD_BY_SEGMENT[activeSegment] ?? 'dashboard'} interactive={false} />

      <header className="presentation-hide sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur-xl">
        <div className="flex h-14 items-center gap-4 px-4 sm:px-6">
          <Link href="/app" className="shrink-0" aria-label="Voltar ao workspace">
            <Logo showText={false} />
          </Link>

          <div className="flex min-w-0 shrink items-center gap-2">
            <Link
              href="/app"
              className="shrink-0 text-ink-subtle transition-colors hover:text-ink"
              aria-label="Voltar ao workspace"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-body-sm font-medium leading-tight" title={dataset.name}>
                {dataset.name}
              </h1>
              <p className="mono-label truncate text-[10px] leading-tight text-ink-subtle">
                {formatInteger(dataset.row_count)} linhas · {dataset.column_count} colunas
              </p>
            </div>
          </div>

          {/* The rail sits inline once there is room, and drops to its own
              scrollable row below when there is not. */}
          <nav className="ml-auto hidden xl:block">
            <NavRail ref={navRef} base={base} active={activeSegment} />
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-1 xl:ml-0">
            <QualityMark score={dataset.quality_score} />
            {actions}
            <ThemePicker />
            <UserMenu />
          </div>
        </div>

        <nav className="border-t border-line/70 px-4 pb-1 pt-1 sm:px-6 xl:hidden">
          <NavRail ref={navRef} base={base} active={activeSegment} />
        </nav>
      </header>

      <main id="conteudo" className="relative z-10 min-w-0 flex-1">
        {children}
      </main>
    </div>
  );
}

const NavRail = forwardRef<HTMLUListElement, { base: string; active: string }>(
  function NavRail({ base, active }, ref) {
    return (
      <ul
        ref={ref}
        className="scroll-fade flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {NAV_ITEMS.map((item) => {
          const isActive = item.segment === active;
          return (
            <li key={item.segment} className="shrink-0">
              <Link
                href={`${base}/${item.segment}`}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'relative block rounded-md px-3 py-1.5 text-body-sm transition-colors duration-150',
                  isActive ? 'text-ink' : 'text-ink-subtle hover:text-ink',
                )}
              >
                {item.label}
                {/* The annotation pen marks where you are. */}
                {isActive && (
                  <span
                    aria-hidden
                    className="absolute inset-x-3 -bottom-px h-px bg-primary"
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    );
  },
);

/**
 * Quality as a measured bar rather than a coloured badge: the score is ordinal,
 * so it is encoded by length, and the reader is never asked to decode a hue.
 */
function QualityMark({ score }: { score: number }) {
  return (
    <div className="mr-1 hidden items-center gap-2 md:flex" title={`Qualidade dos dados: ${score}/100`}>
      <span className="mono-label text-[10px] text-ink-subtle">Qualidade</span>
      <span className="relative h-1 w-12 overflow-hidden rounded-pill bg-line">
        <span
          className="absolute inset-y-0 left-0 bg-primary"
          style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
        />
      </span>
      <span className="numeric text-caption tabular-nums text-ink">{score}</span>
    </div>
  );
}
