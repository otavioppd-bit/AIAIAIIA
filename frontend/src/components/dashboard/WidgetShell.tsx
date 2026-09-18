'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Copy, GripVertical, Info, Maximize2, Minimize2, MoreHorizontal,
  Settings2, Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { IconButton } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import type { Widget } from '@/types/api';

const SHADOWS = { none: '', sm: 'shadow-sm', md: 'shadow-md', lg: 'shadow-lg' };
const RADII = { sm: 'rounded-sm', md: 'rounded-md', lg: 'rounded-lg', xl: 'rounded-xl' };
const PADDINGS = { sm: 'p-3', md: 'p-4', lg: 'p-6' };
const TITLE_SIZES = { sm: 'text-[13px]', md: 'text-[15px]', lg: 'text-lg' };
const FONTS = { sans: 'font-sans', mono: 'font-mono', display: 'font-display' };

interface WidgetShellProps {
  widget: Widget;
  editMode: boolean;
  selected: boolean;
  columns: number;
  rowHeight: number;
  children: React.ReactNode;
  onSelect: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onResize: (delta: { w?: number; h?: number }) => void;
}

/**
 * The chrome around every widget: title, rationale, and — in edit mode — the
 * drag handle, resize controls and actions.
 */
export function WidgetShell({
  widget,
  editMode,
  selected,
  columns,
  rowHeight,
  children,
  onSelect,
  onDuplicate,
  onRemove,
  onResize,
}: WidgetShellProps) {
  const [showRationale, setShowRationale] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.id,
    disabled: !editMode,
  });

  const style = widget.config.style;
  const span = Math.min(Math.max(widget.layout.w, 1), columns);
  const height = widget.layout.h * rowHeight;

  /*
   * The twelve-column composition is a desktop idea. Held at every width it
   * squeezes a chart into 155px on a phone — the layout has to reorganise, not
   * shrink. So each card carries three spans and CSS picks one per breakpoint:
   * full width on a phone, halves and wides going full on a tablet, the
   * designed composition only where there is room for it.
   */
  // Between a phone and a wide screen, two columns is the most a chart stays
  // readable in: anything wider than a half goes full, anything narrower is
  // promoted to a half rather than shrunk into a sliver.
  const tabletSpan = span > columns / 2 ? columns : Math.ceil(columns / 2);
  // A card is never shorter on a phone than it is wide-screen readable.
  const mobileHeight = Math.max(height, widget.type === 'kpi' ? 132 : 264);

  const hasHeader = widget.type !== 'kpi';

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        // A definite height is what makes the grid a grid: content scrolls
        // inside its card instead of stretching the page.
        ['--span-desktop' as string]: span,
        ['--span-tablet' as string]: tabletSpan,
        ['--cell-height' as string]: `${height}px`,
        ['--cell-height-mobile' as string]: `${mobileHeight}px`,
        zIndex: isDragging ? 40 : undefined,
      }}
      data-widget-type={widget.type}
      data-widget-id={widget.id}
      className={cn(
        'widget-cell group/widget relative flex flex-col overflow-hidden transition-[border-color,box-shadow] duration-200',
        style.border && 'border border-line',
        RADII[style.radius] ?? 'rounded-lg',
        SHADOWS[style.shadow] ?? 'shadow-sm',
        FONTS[style.fontFamily] ?? 'font-sans',
        style.background === 'transparent' ? 'bg-transparent' : 'bg-surface',
        isDragging && 'opacity-60 shadow-lg ring-2 ring-primary',
        selected && editMode && 'ring-2 ring-primary ring-offset-2 ring-offset-canvas',
        editMode && 'cursor-pointer hover:border-line-strong',
      )}
      onClick={editMode ? onSelect : undefined}
    >
      {hasHeader && (
        <header
          className={cn(
            'flex shrink-0 items-start justify-between gap-2',
            PADDINGS[style.padding] ?? 'p-4',
            'pb-2',
          )}
        >
          <div className="min-w-0">
            <h3
              className={cn(
                'truncate font-semibold leading-tight tracking-[-0.01em]',
                TITLE_SIZES[style.titleSize] ?? 'text-[15px]',
              )}
              title={widget.title}
            >
              {widget.title}
            </h3>
            {widget.subtitle && (
              <p className="mt-0.5 truncate text-xs text-ink-subtle" title={widget.subtitle}>
                {widget.subtitle}
              </p>
            )}
          </div>

          <div className="presentation-hide flex shrink-0 items-center gap-0.5">
            {widget.rationale && (
              <IconButton
                label="Por que este gráfico"
                size="xs"
                className={cn(
                  'opacity-0 transition-opacity group-hover/widget:opacity-100',
                  showRationale && 'opacity-100 text-primary',
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  setShowRationale((value) => !value);
                }}
              >
                <Info className="h-3.5 w-3.5" />
              </IconButton>
            )}

            {editMode && (
              <>
                <IconButton label="Duplicar" size="xs" onClick={(e) => { e.stopPropagation(); onDuplicate(); }}>
                  <Copy className="h-3.5 w-3.5" />
                </IconButton>
                <IconButton label="Remover" size="xs" className="hover:text-negative" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
                <button
                  {...attributes}
                  {...listeners}
                  aria-label="Mover widget"
                  title="Arraste para reorganizar"
                  onClick={(event) => event.stopPropagation()}
                  className="inline-flex h-6 w-6 cursor-grab items-center justify-center rounded-md
                    text-ink-subtle transition-colors hover:bg-surface-raised hover:text-ink active:cursor-grabbing"
                >
                  <GripVertical className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </header>
      )}

      {showRationale && widget.rationale && (
        <div className="mx-4 mb-2 animate-fade-in rounded-md border border-line bg-surface-sunken p-3">
          {widget.principle && (
            <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-primary">
              {widget.principle}
            </p>
          )}
          <p className="text-xs leading-relaxed text-ink-muted">{widget.rationale}</p>
        </div>
      )}

      <div
        className={cn(
          'min-h-0 flex-1',
          hasHeader ? cn(PADDINGS[style.padding] ?? 'p-4', 'pt-0') : '',
        )}
      >
        {children}
      </div>

      {editMode && (
        <div className="presentation-hide absolute bottom-1.5 right-1.5 flex items-center gap-0.5 rounded-md border border-line bg-surface/95 p-0.5 opacity-0 shadow-sm backdrop-blur transition-opacity group-hover/widget:opacity-100">
          <IconButton
            label="Diminuir largura"
            size="xs"
            disabled={widget.layout.w <= 2}
            onClick={(e) => { e.stopPropagation(); onResize({ w: -1 }); }}
          >
            <Minimize2 className="h-3 w-3" />
          </IconButton>
          <span className="px-1 text-2xs tabular-nums text-ink-subtle">
            {widget.layout.w}×{widget.layout.h}
          </span>
          <IconButton
            label="Aumentar largura"
            size="xs"
            disabled={widget.layout.w >= columns}
            onClick={(e) => { e.stopPropagation(); onResize({ w: 1 }); }}
          >
            <Maximize2 className="h-3 w-3" />
          </IconButton>
          <span className="mx-0.5 h-3.5 w-px bg-line" aria-hidden />
          <IconButton
            label="Diminuir altura"
            size="xs"
            disabled={widget.layout.h <= 1}
            onClick={(e) => { e.stopPropagation(); onResize({ h: -1 }); }}
          >
            <MoreHorizontal className="h-3 w-3" />
          </IconButton>
          <IconButton
            label="Aumentar altura"
            size="xs"
            disabled={widget.layout.h >= 6}
            onClick={(e) => { e.stopPropagation(); onResize({ h: 1 }); }}
          >
            <Settings2 className="h-3 w-3" />
          </IconButton>
        </div>
      )}
    </div>
  );
}
