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
      <div className="relative h-32 w-32">
        <div className="absolute inset-0 rounded-full border border-line" />
        <div className="absolute inset-4 rounded-full border border-line/60" />
        <div className="absolute inset-8 rounded-full bg-primary-soft/40 blur-xl" />
      </div>
    </div>
  );
}

export { OrbScene as LazyDataOrb };
