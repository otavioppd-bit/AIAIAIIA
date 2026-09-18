'use client';

import dynamic from 'next/dynamic';
import { cn } from '@/lib/utils';

/**
 * three.js is ~250 kB gzipped. The 3D layer is a complement to the data, never
 * a prerequisite for reading it, so it loads only when a page actually renders
 * one — and never on the server, where there is no WebGL context.
 */
const OrbScene = dynamic(() => import('./OrbScene').then((module) => module.OrbScene), {
  ssr: false,
  loading: () => <OrbPlaceholder />,
});

export function OrbPlaceholder({ className }: { className?: string }) {
  return (
    <div className={cn('flex h-full w-full items-center justify-center', className)} aria-hidden>
      <svg viewBox="0 0 120 120" className="h-32 w-32 text-primary/40">
        <g stroke="currentColor" strokeWidth="0.6" fill="none">
          <path d="M30 40 L60 28 L90 40 L60 52 Z" />
          <path d="M30 40 V72 L60 84 V52 M90 40 V72 L60 84" />
          <path d="M20 96 H100 M34 104 H86" strokeDasharray="3 4" />
        </g>
        <g fill="currentColor">
          <circle cx="30" cy="40" r="1.6" /><circle cx="60" cy="28" r="1.6" />
          <circle cx="90" cy="40" r="1.6" /><circle cx="60" cy="52" r="1.6" />
          <circle cx="30" cy="72" r="1.6" /><circle cx="90" cy="72" r="1.6" />
          <circle cx="60" cy="84" r="1.6" />
        </g>
      </svg>
    </div>
  );
}

export { OrbScene as LazyDataOrb };
