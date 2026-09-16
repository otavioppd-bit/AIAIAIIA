'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, tokenStore } from '@/lib/api';
import type { User } from '@/types/api';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (payload: {
    email: string;
    password: string;
    full_name?: string;
    company?: string;
  }) => Promise<User>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  updateUser: (patch: Partial<User>) => Promise<User>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      // Render immediately from the cached user, then confirm with the server.
      const cached = tokenStore.user;
      if (cached) setUser(cached);

      if (!tokenStore.access) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const fresh = await api.auth.me();
        if (!cancelled) {
          setUser(fresh);
          tokenStore.setUser(fresh);
        }
      } catch {
        if (!cancelled) {
          tokenStore.clear();
          setUser(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void bootstrap();

    // Keep tabs in sync when one of them logs in or out.
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'prisma.access_token' && !event.newValue) setUser(null);
    };
    window.addEventListener('storage', onStorage);
    return () => {
      cancelled = true;
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const tokens = await api.auth.login({ email, password });
    tokenStore.set(tokens);
    setUser(tokens.user);
    return tokens.user;
  }, []);

  const register = useCallback(
    async (payload: { email: string; password: string; full_name?: string; company?: string }) => {
      const tokens = await api.auth.register(payload);
      tokenStore.set(tokens);
      setUser(tokens.user);
      return tokens.user;
    },
    [],
  );

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    router.push('/login');
  }, [router]);

  const refreshUser = useCallback(async () => {
    const fresh = await api.auth.me();
    setUser(fresh);
    tokenStore.setUser(fresh);
  }, []);

  const updateUser = useCallback(async (patch: Partial<User>) => {
    const updated = await api.auth.updateProfile(patch);
    setUser(updated);
    tokenStore.setUser(updated);
    return updated;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      isAuthenticated: Boolean(user),
      login,
      register,
      logout,
      refreshUser,
      updateUser,
    }),
    [user, loading, login, register, logout, refreshUser, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return context;
}
