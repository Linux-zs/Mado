import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createEmptyInlineFormatState,
  getInlineFormatBadgeText,
  toggleInlineFormatState
} from '../.test-dist/src/inline-format-state.js';

test('inline format state allows stacking regular special styles', () => {
  const highlightedStrong = toggleInlineFormatState(
    toggleInlineFormatState(createEmptyInlineFormatState(), 'strong'),
    'highlight'
  );

  assert.deepEqual(highlightedStrong, {
    strong: true,
    emphasis: false,
    strike: false,
    inlineCode: false,
    highlight: true,
    superscript: false,
    subscript: false,
    kbd: false
  });
  assert.equal(getInlineFormatBadgeText(highlightedStrong), 'B+H');
});

test('inline format state keeps superscript and subscript mutually exclusive', () => {
  const state = toggleInlineFormatState(
    toggleInlineFormatState(createEmptyInlineFormatState(), 'superscript'),
    'subscript'
  );

  assert.equal(state.superscript, false);
  assert.equal(state.subscript, true);
  assert.equal(getInlineFormatBadgeText(state), 'Sub');
});

test('inline code remains exclusive and can be toggled off', () => {
  const styled = toggleInlineFormatState(
    toggleInlineFormatState(createEmptyInlineFormatState(), 'strong'),
    'highlight'
  );
  const inlineCode = toggleInlineFormatState(styled, 'inlineCode');
  assert.deepEqual(inlineCode, {
    strong: false,
    emphasis: false,
    strike: false,
    inlineCode: true,
    highlight: false,
    superscript: false,
    subscript: false,
    kbd: false
  });
  assert.equal(getInlineFormatBadgeText(inlineCode), '<>');

  assert.deepEqual(toggleInlineFormatState(inlineCode, 'inlineCode'), createEmptyInlineFormatState());
});
