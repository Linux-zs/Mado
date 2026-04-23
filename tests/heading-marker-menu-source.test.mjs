import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

test('heading marker format menu exposes all special style toggles', () => {
  assert.match(mainSource, /INLINE_FORMAT_MENU_ITEMS/);
  for (const commandId of [
    'inlineStrong',
    'inlineEmphasis',
    'inlineStrike',
    'inlineCode',
    'inlineHighlight',
    'inlineSuperscript',
    'inlineSubscript',
    'inlineKbd'
  ]) {
    assert.match(mainSource, new RegExp(`EDITOR_COMMAND_IDS\\.${commandId}`));
  }
  assert.doesNotMatch(mainSource, /\['plain', 'strong', 'emphasis', 'strong-emphasis', 'strike', 'inline-code'\]/);
});
