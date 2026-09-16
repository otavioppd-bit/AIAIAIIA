'use client';

import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { formatValue, humanize } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ColumnProfile, DataRow } from '@/types/api';

interface DataTableProps {
  columns: string[];
  rows: DataRow[];
  columnProfiles?: ColumnProfile[];
  /** A pixel cap, or 'fill' to take the height of a constrained parent. */
  maxHeight?: number | 'fill';
  sortable?: boolean;
  className?: string;
  emptyMessage?: string;
}

const ROW_HEIGHT = 36;

/**
 * Virtualised table.
 *
 * Only the visible window is in the DOM, so a 5.000-row page renders the same
 * ~20 nodes as a 50-row one.
 */
export function DataTable({
  columns,
  rows,
  columnProfiles = [],
  maxHeight = 420,
  sortable = true,
  className,
  emptyMessage = 'Nenhum registro para exibir.',
}: DataTableProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [sort, setSort] = useState<{ column: string; desc: boolean } | null>(null);

  const typeByColumn = useMemo(() => {
    const map = new Map<string, ColumnProfile>();
    columnProfiles.forEach((profile) => map.set(profile.name, profile));
    return map;
  }, [columnProfiles]);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const left = a[sort.column];
      const right = b[sort.column];
      if (left === null || left === undefined) return 1;
      if (right === null || right === undefined) return -1;
      if (typeof left === 'number' && typeof right === 'number') {
        return sort.desc ? right - left : left - right;
      }
      return sort.desc
        ? String(right).localeCompare(String(left), 'pt-BR')
        : String(left).localeCompare(String(right), 'pt-BR');
    });
    return copy;
  }, [rows, sort]);

  const virtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const toggleSort = (column: string) => {
    if (!sortable) return;
    setSort((current) => {
      if (current?.column !== column) return { column, desc: true };
      if (current.desc) return { column, desc: false };
      return null;
    });
  };

  if (rows.length === 0) {
    return (
      <div className={cn('flex items-center justify-center p-8 text-[13px] text-ink-subtle', className)}>
        {emptyMessage}
      </div>
    );
  }

  const items = virtualizer.getVirtualItems();

  const fills = maxHeight === 'fill';

  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border border-line',
        fills && 'flex h-full flex-col',
        className,
      )}
    >
      <div
        ref={containerRef}
        className={cn('overflow-auto', fills && 'min-h-0 flex-1')}
        style={fills ? undefined : { maxHeight }}
      >
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 z-10">
            <tr className="bg-surface-sunken">
              {columns.map((column) => {
                const profile = typeByColumn.get(column);
                const numeric =
                  profile && ['integer', 'float', 'currency', 'percentage'].includes(profile.semantic_type);
                const active = sort?.column === column;
                return (
                  <th
                    key={column}
                    scope="col"
                    className={cn(
                      'whitespace-nowrap border-b border-line px-3 py-2 font-medium text-ink-muted',
                      numeric ? 'text-right' : 'text-left',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(column)}
                      disabled={!sortable}
                      className={cn(
                        'inline-flex items-center gap-1 transition-colors',
                        sortable && 'hover:text-ink',
                        numeric && 'flex-row-reverse',
                      )}
                      title={profile ? `${humanize(column)} · ${profile.semantic_type}` : column}
                    >
                      <span className="max-w-[180px] truncate">{humanize(column)}</span>
                      {sortable &&
                        (active ? (
                          sort.desc ? (
                            <ArrowDown className="h-3 w-3 text-primary" />
                          ) : (
                            <ArrowUp className="h-3 w-3 text-primary" />
                          )
                        ) : (
                          <ChevronsUpDown className="h-3 w-3 opacity-25" />
                        ))}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {items.length > 0 && items[0].start > 0 && (
              <tr style={{ height: items[0].start }} aria-hidden />
            )}
            {items.map((item) => {
              const row = sortedRows[item.index];
              return (
                <tr
                  key={item.key}
                  className="border-b border-line/60 transition-colors last:border-0 hover:bg-surface-raised"
                  style={{ height: ROW_HEIGHT }}
                >
                  {columns.map((column) => {
                    const profile = typeByColumn.get(column);
                    const value = row[column];
                    const numeric =
                      profile && ['integer', 'float', 'currency', 'percentage'].includes(profile.semantic_type);
                    const display =
                      typeof value === 'number'
                        ? formatValue(value, 'auto', { semanticType: profile?.semantic_type })
                        : value === null || value === undefined
                          ? '—'
                          : String(value);
                    return (
                      <td
                        key={column}
                        className={cn(
                          'max-w-[260px] truncate px-3',
                          numeric ? 'text-right tabular-nums' : 'text-left',
                          (value === null || value === undefined) && 'text-ink-subtle',
                        )}
                        title={display}
                      >
                        {display}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {items.length > 0 && (
              <tr
                style={{ height: virtualizer.getTotalSize() - (items[items.length - 1]?.end ?? 0) }}
                aria-hidden
              />
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
