'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ArrowLeft, BarChart3, Bot, Compass, FileText, LayoutGrid,
  Menu, Palette, Sparkles, SprayCan, X,
} from 'lucide-react';
import { Logo } from './Logo';
import { ThemePicker } from './ThemePicker';
import { UserMenu } from './UserMenu';
import { Badge } from '@/components/ui/Badge';
import { IconButton } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { formatInteger } from '@/lib/format';
import type { DatasetDetail } from '@/types/api';

const NAV_ITEMS = [
  { segment: 'overview', label: 'Overview', icon: LayoutGrid, emoji: '📊' },
  { segment: 'analytics', label: 'Analytics', icon: BarChart3, emoji: '📈' },
  { segment: 'explore', label: 'Explore', icon: Compass, emoji: '🔍' },
  { segment: 'analyst', label: 'AI Analyst', icon: Bot, emoji: '🤖' },
  { segment: 'quality', label: 'Data Quality', icon: SprayCan, emoji: '🧹' },
  { segment: 'customize', label: 'Customize', icon: Palette, emoji: '🎨' },
  { segment: 'reports', label: 'Reports', icon: FileText, emoji: '📄' },
] as const;

interface DatasetShellProps {
  dataset: DatasetDetail;
  children: React.ReactNode;
  actions?: React.ReactNode;
}

export function DatasetShell({ dataset, children, actions }: DatasetShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the drawer whenever navigation happens.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const base = `/app/datasets/${dataset.id}`;
  const activeSegment =
    NAV_ITEMS.find((item) => pathname?.startsWith(`${base}/${item.segment}`))?.segment ?? 'overview';

  const qualityTone =
    dataset.quality_score >= 80 ? 'positive' : dataset.quality_score >= 60 ? 'warning' : 'negative';

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="presentation-hide sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-xl">
        <div className="flex h-14 items-center gap-3 px-3 sm:px-5">
          <IconButton
            label="Abrir navegação"
            size="sm"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-4 w-4" />
          </IconButton>

          <Link href="/app" className="hidden shrink-0 sm:block">
            <Logo showText={false} />
          </Link>

          <div className="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden />

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Link
                href="/app"
                className="shrink-0 text-ink-subtle transition-colors hover:text-ink"
                aria-label="Voltar ao workspace"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
              </Link>
              <h1 className="truncate text-sm font-semibold tracking-[-0.01em]" title={dataset.name}>
                {dataset.name}
              </h1>
            </div>
            <p className="hidden truncate text-2xs text-ink-subtle sm:block">
              {formatInteger(dataset.row_count)} registros · {dataset.column_count} colunas
            </p>
          </div>

          <Badge tone={qualityTone} className="hidden shrink-0 md:inline-flex">
            Qualidade {dataset.quality_score}/100
          </Badge>

          <div className="flex shrink-0 items-center gap-1">
            {actions}
            <ThemePicker />
            <UserMenu />
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Desktop sidebar */}
        <nav className="presentation-hide sticky top-14 hidden h-[calc(100vh-3.5rem)] w-56 shrink-0 border-r border-line bg-surface/40 p-3 lg:block">
          <SidebarLinks base={base} active={activeSegment} />
          <DomainCard dataset={dataset} />
        </nav>

        {/* Mobile drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div
              className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-sm"
              onClick={() => setMobileOpen(false)}
              aria-hidden
            />
            <nav className="absolute left-0 top-0 h-full w-64 animate-fade-in border-r border-line bg-surface p-3">
              <div className="mb-3 flex items-center justify-between">
                <Logo />
                <IconButton label="Fechar" size="sm" onClick={() => setMobileOpen(false)}>
                  <X className="h-4 w-4" />
                </IconButton>
              </div>
              <SidebarLinks base={base} active={activeSegment} />
              <DomainCard dataset={dataset} />
            </nav>
          </div>
        )}

        <main id="conteudo" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}

function SidebarLinks({ base, active }: { base: string; active: string }) {
  return (
    <ul className="space-y-0.5">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = item.segment === active;
        return (
          <li key={item.segment}>
            <Link
              href={`${base}/${item.segment}`}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-all duration-150',
                isActive
                  ? 'bg-primary-soft text-primary'
                  : 'text-ink-muted hover:bg-surface-raised hover:text-ink',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function DomainCard({ dataset }: { dataset: DatasetDetail }) {
  const domain = dataset.analysis?.domain;
  if (!domain || domain.key === 'generic') return null;

  return (
    <div className="mt-4 rounded-lg border border-line bg-surface-sunken p-3">
      <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
        <Sparkles className="h-3 w-3" />
        Contexto detectado
      </p>
      <p className="mt-1.5 text-[13px] font-medium text-ink">{domain.label}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-subtle">{domain.description}</p>
      {domain.candidates?.[0]?.matched_keywords?.length > 0 && (
        <p className="mt-2 text-2xs leading-relaxed text-ink-subtle">
          Identificado pelas colunas:{' '}
          <span className="font-mono">
            {domain.candidates[0].matched_keywords.slice(0, 4).join(', ')}
          </span>
        </p>
      )}
    </div>
  );
}
