import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('skeleton rounded-md', className)} aria-hidden {...props} />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          className="h-3"
          style={{ width: `${100 - index * 12 - (index === lines - 1 ? 20 : 0)}%` }}
        />
      ))}
    </div>
  );
}

export function ChartSkeleton({ className }: { className?: string }) {
  // Mimics a plot area so the layout does not jump when data arrives.
  return (
    <div className={cn('flex h-full w-full flex-col justify-end gap-2 p-4', className)} aria-hidden>
      <div className="flex flex-1 items-end gap-2">
        {[52, 78, 40, 92, 64, 84, 48].map((height, index) => (
          <Skeleton key={index} className="flex-1 rounded-t-sm" style={{ height: `${height}%` }} />
        ))}
      </div>
      <Skeleton className="h-2 w-full" />
    </div>
  );
}
