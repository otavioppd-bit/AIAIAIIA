import { cn } from '@/lib/utils';

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-2 p-6' : 'gap-3 p-10',
        className,
      )}
    >
      {icon && (
        <div
          className={cn(
            'flex items-center justify-center rounded-xl border border-line bg-surface-sunken text-ink-subtle',
            compact ? 'h-9 w-9' : 'h-12 w-12',
          )}
        >
          {icon}
        </div>
      )}
      <div className="max-w-sm">
        <p className={cn('font-medium text-ink', compact ? 'text-[13px]' : 'text-sm')}>{title}</p>
        {description && (
          <p className={cn('mt-1 leading-relaxed text-ink-subtle', compact ? 'text-xs' : 'text-[13px]')}>
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
