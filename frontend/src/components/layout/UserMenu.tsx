'use client';

import { useState } from 'react';
import Link from 'next/link';
import { LogOut, Settings, User as UserIcon } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

export function UserMenu() {
  const [open, setOpen] = useState(false);
  const { user, logout } = useAuth();

  if (!user) return null;

  const initials =
    (user.full_name || user.email)
      .split(/[\s@.]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'U';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label="Menu do usuário"
        className="flex h-8 w-8 items-center justify-center rounded-full border border-line
          bg-primary-soft text-xs font-semibold text-primary transition-all hover:border-primary/40"
      >
        {initials}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 top-10 z-50 w-56 animate-scale-in rounded-lg border border-line bg-surface p-1 shadow-lg">
            <div className="border-b border-line px-3 py-2.5">
              <p className="truncate text-[13px] font-medium">{user.full_name || 'Sem nome'}</p>
              <p className="truncate text-xs text-ink-subtle">{user.email}</p>
            </div>
            <Link
              href="/app/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-[13px] text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink"
            >
              <Settings className="h-3.5 w-3.5" />
              Configurações
            </Link>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                logout();
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px]',
                'text-ink-muted transition-colors hover:bg-negative/10 hover:text-negative',
              )}
            >
              <LogOut className="h-3.5 w-3.5" />
              Sair
            </button>
          </div>
        </>
      )}
    </div>
  );
}
