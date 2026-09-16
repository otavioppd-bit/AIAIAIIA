'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '@/components/ui/Button';

/**
 * Full-screen presentation: chrome is hidden via the `.presentation-hide`
 * contract, and Escape always exits — including out of browser fullscreen.
 */
export function PresentationMode({
  active,
  onExit,
  title,
  subtitle,
  children,
}: {
  active: boolean;
  onExit: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  // `onExit` is an inline arrow at the call site, so a new identity on every
  // render. Holding it in a ref keeps the effect keyed on `active` alone —
  // otherwise each render would exit and re-request fullscreen, and the second
  // request has no user gesture behind it, dropping the presenter out.
  const exitRef = useRef(onExit);
  exitRef.current = onExit;

  useEffect(() => {
    if (!active) return undefined;

    document.body.classList.add('presentation-mode');
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') exitRef.current();
    };
    document.addEventListener('keydown', onKeyDown);

    // Browser fullscreen is best-effort: it is blocked without a user gesture
    // in some browsers, and the overlay works either way.
    void document.documentElement.requestFullscreen?.().catch(() => undefined);

    return () => {
      document.body.classList.remove('presentation-mode');
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', onKeyDown);
      if (document.fullscreenElement) {
        void document.exitFullscreen?.().catch(() => undefined);
      }
    };
  }, [active]);

  if (!active) return null;

  return (
    <div className="fixed inset-0 z-[90] animate-fade-in overflow-y-auto bg-canvas">
      <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-canvas/90 px-6 py-4 backdrop-blur-xl sm:px-10">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-[-0.02em] sm:text-xl">{title}</h1>
          {subtitle && <p className="mt-0.5 truncate text-[13px] text-ink-muted">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <kbd className="hidden rounded-sm border border-line bg-surface-sunken px-1.5 py-0.5 text-2xs text-ink-subtle sm:inline">
            Esc
          </kbd>
          <IconButton label="Sair da apresentação" variant="secondary" onClick={onExit}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
      <div className="px-6 py-6 sm:px-10">{children}</div>
    </div>
  );
}
