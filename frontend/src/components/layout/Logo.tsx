import { cn } from '@/lib/utils';

/**
 * A prism: one beam enters, three separate rays leave.
 *
 * That is the product in a mark — a single undifferentiated file goes in,
 * distinct readable views come out. The incoming beam and the fanned rays are
 * what keep it from reading as a warning triangle.
 */
export function Logo({ className, showText = true }: { className?: string; showText?: boolean }) {
  return (
    <span className={cn('inline-flex select-none items-center gap-2', className)}>
      <svg viewBox="0 0 32 28" className="h-6 w-7 shrink-0" aria-hidden>
        <defs>
          <linearGradient id="prisma-ray-a" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgb(var(--color-primary))" stopOpacity="0.25" />
            <stop offset="100%" stopColor="rgb(var(--color-primary))" />
          </linearGradient>
          <linearGradient id="prisma-ray-b" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgb(var(--color-teal))" stopOpacity="0.25" />
            <stop offset="100%" stopColor="rgb(var(--color-teal))" />
          </linearGradient>
          <linearGradient id="prisma-ray-c" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgb(var(--color-amber))" stopOpacity="0.25" />
            <stop offset="100%" stopColor="rgb(var(--color-amber))" />
          </linearGradient>
        </defs>

        {/* Incoming beam */}
        <path
          d="M1 14h6.5"
          stroke="rgb(var(--color-ink-subtle))"
          strokeWidth="1.6"
          strokeLinecap="round"
        />

        {/* The prism itself */}
        <path
          d="M12.5 3.6 21.4 22.2a1.1 1.1 0 0 1-1 1.6H9.7a1.1 1.1 0 0 1-1-1.6Z"
          fill="rgb(var(--color-primary))"
          fillOpacity="0.12"
          stroke="rgb(var(--color-primary))"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />

        {/* Dispersed rays */}
        <path d="M20 12.5 30.5 9.5" stroke="url(#prisma-ray-a)" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M20.6 15.5 31 15.5" stroke="url(#prisma-ray-b)" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M21.4 18.4 30.6 21.4" stroke="url(#prisma-ray-c)" strokeWidth="1.7" strokeLinecap="round" />
      </svg>

      {showText && (
        <span className="text-[15px] font-semibold tracking-[-0.02em]">
          Prisma<span className="text-ink-subtle"> Analytics</span>
        </span>
      )}
    </span>
  );
}
