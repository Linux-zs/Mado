export type AppearanceTheme = 'system' | 'light' | 'dark';
export type AppearanceFontSelection = 'system' | string;
export type AppearanceTypographyStyle = 'normal' | 'bold' | 'italic' | 'boldItalic';

export type AppearanceTypography = {
  style: AppearanceTypographyStyle;
  sizePx: number;
};

export type AppearanceSettings = {
  theme: AppearanceTheme;
  typoraThemeId: string | null;
  fonts: {
    cjk: AppearanceFontSelection;
    latin: AppearanceFontSelection;
    code: AppearanceFontSelection;
  };
  bodyTypography: AppearanceTypography;
  codeTypography: AppearanceTypography;
};

const APPEARANCE_THEMES = new Set<AppearanceTheme>(['system', 'light', 'dark']);
const APPEARANCE_TYPOGRAPHY_STYLES = new Set<AppearanceTypographyStyle>([
  'normal',
  'bold',
  'italic',
  'boldItalic'
]);
const APPEARANCE_BODY_SIZE_DEFAULT = 18;
const APPEARANCE_CODE_SIZE_DEFAULT = 13;
const APPEARANCE_TYPOGRAPHY_SIZE_MIN = 10;
const APPEARANCE_TYPOGRAPHY_SIZE_MAX = 36;

export function createDefaultAppearanceSettings(): AppearanceSettings {
  return {
    theme: 'system',
    typoraThemeId: null,
    fonts: {
      cjk: 'system',
      latin: 'system',
      code: 'system'
    },
    bodyTypography: {
      style: 'normal',
      sizePx: APPEARANCE_BODY_SIZE_DEFAULT
    },
    codeTypography: {
      style: 'normal',
      sizePx: APPEARANCE_CODE_SIZE_DEFAULT
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

function normalizeAppearanceThemeId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeAppearanceTypography(
  value: unknown,
  defaults: AppearanceTypography
): AppearanceTypography {
  if (!value || typeof value !== 'object') {
    return defaults;
  }

  const candidate = value as {
    style?: unknown;
    sizePx?: unknown;
  };
  const style =
    typeof candidate.style === 'string' &&
    APPEARANCE_TYPOGRAPHY_STYLES.has(candidate.style as AppearanceTypographyStyle)
      ? (candidate.style as AppearanceTypographyStyle)
      : defaults.style;
  const rawSize =
    typeof candidate.sizePx === 'number'
      ? candidate.sizePx
      : typeof candidate.sizePx === 'string'
        ? Number(candidate.sizePx)
        : Number.NaN;

  return {
    style,
    sizePx: Number.isFinite(rawSize)
      ? Math.min(
          APPEARANCE_TYPOGRAPHY_SIZE_MAX,
          Math.max(APPEARANCE_TYPOGRAPHY_SIZE_MIN, Math.round(rawSize))
        )
      : defaults.sizePx
  };
}

export function normalizeAppearanceSettings(value: unknown): AppearanceSettings {
  const defaults = createDefaultAppearanceSettings();

  if (!value || typeof value !== 'object') {
    return defaults;
  }

  const candidate = value as {
    theme?: unknown;
    typoraThemeId?: unknown;
    fonts?: {
      cjk?: unknown;
      latin?: unknown;
      code?: unknown;
    };
    bodyTypography?: unknown;
    codeTypography?: unknown;
  };

  return {
    theme:
      typeof candidate.theme === 'string' && APPEARANCE_THEMES.has(candidate.theme as AppearanceTheme)
        ? (candidate.theme as AppearanceTheme)
        : defaults.theme,
    typoraThemeId: normalizeAppearanceThemeId(candidate.typoraThemeId),
    fonts: {
      cjk: normalizeAppearanceFontSelection(candidate.fonts?.cjk),
      latin: normalizeAppearanceFontSelection(candidate.fonts?.latin),
      code: normalizeAppearanceFontSelection(candidate.fonts?.code)
    },
    bodyTypography: normalizeAppearanceTypography(candidate.bodyTypography, defaults.bodyTypography),
    codeTypography: normalizeAppearanceTypography(candidate.codeTypography, defaults.codeTypography)
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

export function resolveAppearanceTypographyStyle(style: AppearanceTypographyStyle): {
  fontStyle: 'normal' | 'italic';
  fontWeight: '400' | '700';
} {
  switch (style) {
    case 'bold':
      return { fontStyle: 'normal', fontWeight: '700' };
    case 'italic':
      return { fontStyle: 'italic', fontWeight: '400' };
    case 'boldItalic':
      return { fontStyle: 'italic', fontWeight: '700' };
    case 'normal':
    default:
      return { fontStyle: 'normal', fontWeight: '400' };
  }
}
