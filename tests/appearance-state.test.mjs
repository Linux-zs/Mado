import test from 'node:test';
import assert from 'node:assert/strict';

import {
  APPEARANCE_THEMES,
  createDefaultAppearanceSettings,
  normalizeAppearanceSettings,
  resolveAppearanceDisplayTheme,
  resolveAppearanceFontStack,
  resolveAppearanceTypographyStyle
} from '../.test-dist/src/appearance-state.js';

test('appearance themes include vscode inspired options and github light', () => {
  assert.deepEqual(APPEARANCE_THEMES, [
    'system',
    'light',
    'dark',
    'one-dark-pro',
    'dracula',
    'catppuccin-mocha',
    'night-owl',
    'tokyo-night',
    'github-light'
  ]);
});

test('createDefaultAppearanceSettings uses system defaults for theme and font slots', () => {
  assert.deepEqual(createDefaultAppearanceSettings(), {
    theme: 'system',
    fonts: {
      cjk: 'system',
      latin: 'system',
      code: 'system'
    },
    bodyTypography: {
      style: 'normal',
      sizePx: 18
    },
    codeTypography: {
      style: 'normal',
      sizePx: 13
    }
  });
});

test('normalizeAppearanceSettings sanitizes invalid persisted values', () => {
  assert.deepEqual(
    normalizeAppearanceSettings({
      theme: 'catppuccin-mocha',
      fonts: {
        cjk: '',
        latin: '  Georgia  ',
        code: 12
      },
      bodyTypography: {
        style: 'boldItalic',
        sizePx: '24'
      },
      codeTypography: {
        style: 'broken',
        sizePx: 2
      }
    }),
    {
      theme: 'catppuccin-mocha',
      fonts: {
        cjk: 'system',
        latin: 'Georgia',
        code: 'system'
      },
      bodyTypography: {
        style: 'boldItalic',
        sizePx: 24
      },
      codeTypography: {
        style: 'normal',
        sizePx: 10
      }
    }
  );

  assert.equal(normalizeAppearanceSettings({ theme: 'unknown' }).theme, 'system');
});

test('resolveAppearanceDisplayTheme follows system preference only for system theme', () => {
  assert.equal(resolveAppearanceDisplayTheme('system', true), 'dark');
  assert.equal(resolveAppearanceDisplayTheme('system', false), 'light');
  assert.equal(resolveAppearanceDisplayTheme('light', true), 'light');
  assert.equal(resolveAppearanceDisplayTheme('dark', false), 'dark');
  assert.equal(resolveAppearanceDisplayTheme('one-dark-pro', false), 'one-dark-pro');
  assert.equal(resolveAppearanceDisplayTheme('github-light', true), 'github-light');
});

test('resolveAppearanceFontStack injects selected latin and cjk families ahead of fallbacks', () => {
  assert.equal(
    resolveAppearanceFontStack({
      latin: 'Georgia',
      cjk: 'Microsoft YaHei UI',
      fallback: ['serif']
    }),
    '"Georgia", "Microsoft YaHei UI", serif'
  );

  assert.equal(
    resolveAppearanceFontStack({
      latin: 'system',
      cjk: 'system',
      fallback: ['sans-serif']
    }),
    'sans-serif'
  );
});

test('resolveAppearanceTypographyStyle maps ui labels to css weight and style', () => {
  assert.deepEqual(resolveAppearanceTypographyStyle('normal'), {
    fontStyle: 'normal',
    fontWeight: '400'
  });
  assert.deepEqual(resolveAppearanceTypographyStyle('bold'), {
    fontStyle: 'normal',
    fontWeight: '700'
  });
  assert.deepEqual(resolveAppearanceTypographyStyle('italic'), {
    fontStyle: 'italic',
    fontWeight: '400'
  });
  assert.deepEqual(resolveAppearanceTypographyStyle('boldItalic'), {
    fontStyle: 'italic',
    fontWeight: '700'
  });
});
