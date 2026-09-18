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
    name: 'Blueprint',
    description: 'A superfície canônica: void quase preto, contenção tracejada, uma só caneta de anotação.',
    mode: 'dark',
    preview: ['#000000', '#1c1c1c', '#7089ba'],
  },
  {
    id: 'light',
    name: 'Paper',
    description: 'O mesmo desenho sobre papel — para exportar, imprimir e apresentar.',
    mode: 'light',
    preview: ['#ffffff', '#d8d8d8', '#4a5f8a'],
  },
  {
    id: 'contrast',
    name: 'Alto contraste',
    description: 'Contraste elevado e linhas mais fortes, para leitura com baixa visão.',
    mode: 'dark',
    preview: ['#000000', '#bebebe', '#a0b8e6'],
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
    // Dark is the identity, not a preference: the blueprint only exists on the
    // void. A light-mode OS no longer overrides it — the picker still can.
    var theme = valid.indexOf(stored) !== -1 ? stored : '${DEFAULT_THEME}';
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
