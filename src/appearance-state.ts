export type AppearanceTheme = 'system' | 'light' | 'dark';
export type AppearanceFontSelection = 'system' | string;

export type AppearanceSettings = {
  theme: AppearanceTheme;
  fonts: {
    cjk: AppearanceFontSelection;
    latin: AppearanceFontSelection;
    code: AppearanceFontSelection;
  };
};

const APPEARANCE_THEMES = new Set<AppearanceTheme>(['system', 'light', 'dark']);

export function createDefaultAppearanceSettings(): AppearanceSettings {
  return {
    theme: 'system',
    fonts: {
      cjk: 'system',
      latin: 'system',
      code: 'system'
    }
  };
}

function normalizeAppearanceFontSelection(value: unknown): AppearanceFontSelection {
  if (typeof value !== 'string') {
    return 'system';
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : 'system';
}

export function normalizeAppearanceSettings(value: unknown): AppearanceSettings {
  const defaults = createDefaultAppearanceSettings();

  if (!value || typeof value !== 'object') {
    return defaults;
  }

  const candidate = value as {
    theme?: unknown;
    fonts?: {
      cjk?: unknown;
      latin?: unknown;
      code?: unknown;
    };
  };

  return {
    theme:
      typeof candidate.theme === 'string' && APPEARANCE_THEMES.has(candidate.theme as AppearanceTheme)
        ? (candidate.theme as AppearanceTheme)
        : defaults.theme,
    fonts: {
      cjk: normalizeAppearanceFontSelection(candidate.fonts?.cjk),
      latin: normalizeAppearanceFontSelection(candidate.fonts?.latin),
      code: normalizeAppearanceFontSelection(candidate.fonts?.code)
    }
  };
}

export function resolveAppearanceDisplayTheme(
  theme: AppearanceTheme,
  prefersDark: boolean
): 'light' | 'dark' {
  if (theme === 'system') {
    return prefersDark ? 'dark' : 'light';
  }

  return theme;
}

export function resolveAppearanceFontStack(input: {
  latin: AppearanceFontSelection;
  cjk: AppearanceFontSelection;
  fallback: string[];
}): string {
  const fonts: string[] = [];

  if (input.latin !== 'system') {
    fonts.push(`"${input.latin}"`);
  }

  if (input.cjk !== 'system' && input.cjk !== input.latin) {
    fonts.push(`"${input.cjk}"`);
  }

  fonts.push(...input.fallback);
  return fonts.join(', ');
}
