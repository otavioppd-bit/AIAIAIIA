'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      // Preserve the destination so login returns the user where they were.
      const next = encodeURIComponent(pathname ?? '/app');
      router.replace(`/login?next=${next}`);
    }
  }, [loading, isAuthenticated, router, pathname]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <Loader2 className="h-5 w-5 animate-spin text-ink-subtle" />
        <span className="sr-only">Carregando</span>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  return <>{children}</>;
}
