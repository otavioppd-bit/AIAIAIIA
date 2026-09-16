export interface ThemeDefinition {
  id: string;
  name: string;
  description: string;
  mode: 'light' | 'dark';
  /** Three swatches shown in the theme picker preview. */
  preview: [string, string, string];
}

export const THEMES: ThemeDefinition[] = [
  {
    id: 'dark',
    name: 'Dark',
    description: 'Contraste alto sobre fundo profundo. Padrão da plataforma.',
    mode: 'dark',
    preview: ['#111118', '#7c7aff', '#34c77b'],
  },
  {
    id: 'light',
    name: 'Light',
    description: 'Claro e neutro, ideal para apresentações e impressão.',
    mode: 'light',
    preview: ['#ffffff', '#5856d6', '#16a35e'],
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Azul-marinho profundo com acentos frios.',
    mode: 'dark',
    preview: ['#0c1226', '#60a5fa', '#34d399'],
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Quase monocromático. Máximo espaço negativo, zero ruído.',
    mode: 'light',
    preview: ['#ffffff', '#0a0a0a', '#1d7a4a'],
  },
  {
    id: 'executive',
    name: 'Executive',
    description: 'Papel quente e tipografia serifada para relatórios.',
    mode: 'light',
    preview: ['#f9f7f3', '#164e63', '#15694a'],
  },
  {
    id: 'data-focus',
    name: 'Data Focus',
    description: 'Cromo neutro para que os gráficos carreguem toda a cor.',
    mode: 'dark',
    preview: ['#151820', '#00d0be', '#58b4ff'],
  },
];

export const THEME_IDS = THEMES.map((theme) => theme.id);
export const DEFAULT_THEME = 'dark';
export const THEME_STORAGE_KEY = 'prisma.theme';

export function getTheme(id: string | null | undefined): ThemeDefinition {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

export function themeMode(id: string | null | undefined): 'light' | 'dark' {
  return getTheme(id).mode;
}

/**
 * Applied before React hydrates so the first paint already carries the theme —
 * without this the page flashes the default palette.
 */
export const THEME_BOOTSTRAP_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('${THEME_STORAGE_KEY}');
    var valid = ${JSON.stringify(THEME_IDS)};
    var theme = valid.indexOf(stored) !== -1 ? stored : null;
    if (!theme) {
      var prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
      theme = prefersLight ? 'light' : '${DEFAULT_THEME}';
    }
    var lightThemes = ${JSON.stringify(THEMES.filter((t) => t.mode === 'light').map((t) => t.id))};
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute(
      'data-theme-mode',
      lightThemes.indexOf(theme) !== -1 ? 'light' : 'dark'
    );
    document.documentElement.style.colorScheme = lightThemes.indexOf(theme) !== -1 ? 'light' : 'dark';
  } catch (e) {}
})();
`;
