import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_CODE_BLOCK_LANGUAGE_BADGE_TEXT,
  DEFAULT_CODE_BLOCK_HIGHLIGHT_LANGUAGE,
  getCodeBlockLanguageBadgeText,
  normalizeCodeBlockLanguageInput,
  resolveCodeBlockHighlightLanguage
} from '../.test-dist/src/code-block-language-state.js';

test('normalizeCodeBlockLanguageInput trims aliases and lowercases known values', () => {
  assert.equal(normalizeCodeBlockLanguageInput(' Shell '), 'bash');
  assert.equal(normalizeCodeBlockLanguageInput('TSX'), 'typescript');
  assert.equal(normalizeCodeBlockLanguageInput('C#'), 'csharp');
});

test('normalizeCodeBlockLanguageInput keeps unknown languages as trimmed lowercase text', () => {
  assert.equal(normalizeCodeBlockLanguageInput(' Mermaid '), 'mermaid');
});

test('normalizeCodeBlockLanguageInput clears blank input', () => {
  assert.equal(normalizeCodeBlockLanguageInput('   '), null);
});

test('resolveCodeBlockHighlightLanguage keeps supported languages and falls back to plaintext', () => {
  const supportedLanguages = new Set(['bash', 'python', DEFAULT_CODE_BLOCK_HIGHLIGHT_LANGUAGE]);
  const isSupportedLanguage = (language) => supportedLanguages.has(language);

  assert.equal(resolveCodeBlockHighlightLanguage('python', isSupportedLanguage), 'python');
  assert.equal(resolveCodeBlockHighlightLanguage('mermaid', isSupportedLanguage), DEFAULT_CODE_BLOCK_HIGHLIGHT_LANGUAGE);
  assert.equal(resolveCodeBlockHighlightLanguage(null, isSupportedLanguage), DEFAULT_CODE_BLOCK_HIGHLIGHT_LANGUAGE);
});

test('getCodeBlockLanguageBadgeText falls back to the default badge label', () => {
  assert.equal(getCodeBlockLanguageBadgeText(null), DEFAULT_CODE_BLOCK_LANGUAGE_BADGE_TEXT);
  assert.equal(getCodeBlockLanguageBadgeText('python'), 'python');
});
