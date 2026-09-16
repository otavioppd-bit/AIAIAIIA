'use client';

import { useState } from 'react';
import { Check, Moon, Palette, Sun } from 'lucide-react';
import { IconButton } from '@/components/ui/Button';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';

export function ThemePicker({ align = 'right' }: { align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const { theme, themes, setTheme, mode } = useTheme();

  return (
    <div className="relative">
      <IconButton
        label="Alterar tema"
        size="sm"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <Palette className="h-4 w-4" />
      </IconButton>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div
            className={cn(
              'absolute top-10 z-50 w-64 animate-scale-in rounded-lg border border-line bg-surface p-1.5 shadow-lg',
              align === 'right' ? 'right-0' : 'left-0',
            )}
            role="menu"
          >
            <p className="px-2 py-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
              Tema
            </p>
            {themes.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitemradio"
                aria-checked={item.id === theme}
                onClick={() => {
                  setTheme(item.id);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-md p-2 text-left transition-colors',
                  item.id === theme ? 'bg-primary-soft' : 'hover:bg-surface-raised',
                )}
              >
                <span className="mt-0.5 flex shrink-0 overflow-hidden rounded-sm border border-line">
                  {item.preview.map((color) => (
                    <span key={color} className="h-4 w-2" style={{ backgroundColor: color }} />
                  ))}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        'text-[13px] font-medium',
                        item.id === theme ? 'text-primary' : 'text-ink',
                      )}
                    >
                      {item.name}
                    </span>
                    {item.mode === 'dark' ? (
                      <Moon className="h-2.5 w-2.5 text-ink-subtle" />
                    ) : (
                      <Sun className="h-2.5 w-2.5 text-ink-subtle" />
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-ink-subtle">
                    {item.description}
                  </span>
                </span>
                {item.id === theme && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function ModeToggle() {
  const { mode, toggleMode } = useTheme();
  return (
    <IconButton
      label={mode === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
      size="sm"
      onClick={toggleMode}
    >
      {mode === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </IconButton>
  );
}
