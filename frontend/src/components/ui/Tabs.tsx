'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

export interface TabItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  count?: number;
}

export function Tabs({
  items,
  value,
  onChange,
  className,
  size = 'md',
}: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const listRef = useRef<HTMLDivElement>(null);

  // Four labelled tabs are wider than a phone. Left unwrapped, the strip made
  // the whole page scroll sideways to reach the last one; contained here it
  // scrolls on its own, and the selected tab is brought into view.
  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [value]);

  return (
    <div
      className={cn(
        'scroll-fade-x -mx-0.5 max-w-full overflow-x-auto px-0.5',
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      <div
        ref={listRef}
        role="tablist"
        className="inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface-sunken p-0.5"
      >
        {items.map((item) => {
          const active = item.id === value;
          return (
            <button
              key={item.id}
              role="tab"
              aria-selected={active}
              onClick={() => onChange(item.id)}
              className={cn(
                'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-all duration-150',
                size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]',
                active ? 'bg-surface text-ink shadow-xs' : 'text-ink-muted hover:text-ink',
              )}
            >
              {item.icon}
              {item.label}
              {item.count !== undefined && (
                <span
                  className={cn(
                    'rounded-sm px-1 text-2xs tabular-nums',
                    active ? 'bg-primary-soft text-primary' : 'bg-surface-raised text-ink-subtle',
                  )}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
