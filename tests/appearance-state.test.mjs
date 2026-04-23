import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDefaultAppearanceSettings,
  normalizeAppearanceSettings,
  resolveAppearanceDisplayTheme,
  resolveAppearanceFontStack,
  resolveAppearanceTypographyStyle
} from '../.test-dist/src/appearance-state.js';

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
      theme: 'unknown',
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
      theme: 'system',
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
});

test('resolveAppearanceDisplayTheme follows system preference only for system theme', () => {
  assert.equal(resolveAppearanceDisplayTheme('system', true), 'dark');
  assert.equal(resolveAppearanceDisplayTheme('system', false), 'light');
  assert.equal(resolveAppearanceDisplayTheme('light', true), 'light');
  assert.equal(resolveAppearanceDisplayTheme('dark', false), 'dark');
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
