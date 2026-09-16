'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_THEME,
  THEMES,
  THEME_IDS,
  THEME_STORAGE_KEY,
  getTheme,
  themeMode,
  type ThemeDefinition,
} from '@/lib/themes';

interface ThemeContextValue {
  theme: string;
  mode: 'light' | 'dark';
  definition: ThemeDefinition;
  themes: ThemeDefinition[];
  setTheme: (id: string) => void;
  toggleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyTheme(id: string): void {
  const root = document.documentElement;
  const mode = themeMode(id);
  root.setAttribute('data-theme', id);
  root.setAttribute('data-theme-mode', mode);
  root.style.colorScheme = mode;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<string>(DEFAULT_THEME);

  // The bootstrap script already painted the correct theme; read it back so
  // React state agrees with the DOM instead of overwriting it.
  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme');
    if (current && THEME_IDS.includes(current)) {
      setThemeState(current);
    }
  }, []);

  const setTheme = useCallback((id: string) => {
    const valid = THEME_IDS.includes(id) ? id : DEFAULT_THEME;
    setThemeState(valid);
    applyTheme(valid);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, valid);
    } catch {
      /* private mode: the theme simply will not persist */
    }
  }, []);

  const toggleMode = useCallback(() => {
    const current = getTheme(theme);
    const next = THEMES.find((t) => t.mode !== current.mode && (t.id === 'light' || t.id === 'dark'));
    setTheme(next?.id ?? (current.mode === 'dark' ? 'light' : 'dark'));
  }, [theme, setTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      mode: themeMode(theme),
      definition: getTheme(theme),
      themes: THEMES,
      setTheme,
      toggleMode,
    }),
    [theme, setTheme, toggleMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme deve ser usado dentro de ThemeProvider');
  return context;
}
