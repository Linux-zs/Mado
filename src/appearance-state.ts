export type AppearanceTheme =
  | 'system'
  | 'light'
  | 'dark'
  | 'one-dark-pro'
  | 'dracula'
  | 'catppuccin-mocha'
  | 'night-owl'
  | 'tokyo-night'
  | 'github-light';
export type AppearanceResolvedTheme = Exclude<AppearanceTheme, 'system'>;
export type AppearanceFontSelection = 'system' | string;
export type AppearanceTypographyStyle = 'normal' | 'bold' | 'italic' | 'boldItalic';

export type AppearanceTypography = {
  style: AppearanceTypographyStyle;
  sizePx: number;
};

export type AppearanceSettings = {
  theme: AppearanceTheme;
  fonts: {
    cjk: AppearanceFontSelection;
    latin: AppearanceFontSelection;
    code: AppearanceFontSelection;
  };
  bodyTypography: AppearanceTypography;
  codeTypography: AppearanceTypography;
};

export const APPEARANCE_THEMES: readonly AppearanceTheme[] = [
  'system',
  'light',
  'dark',
  'one-dark-pro',
  'dracula',
  'catppuccin-mocha',
  'night-owl',
  'tokyo-night',
  'github-light'
];

const APPEARANCE_THEME_SET = new Set<AppearanceTheme>(APPEARANCE_THEMES);
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
      typeof candidate.theme === 'string' && APPEARANCE_THEME_SET.has(candidate.theme as AppearanceTheme)
        ? (candidate.theme as AppearanceTheme)
        : defaults.theme,
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
): AppearanceResolvedTheme {
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
