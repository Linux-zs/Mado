import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveMarkdownSyncDecision,
  synchronizeMarkdownContent
} from '../.test-dist/src/milkdown-sync-state.js';

test('resolveMarkdownSyncDecision skips unchanged synchronized markdown without pending changes', () => {
  const decision = resolveMarkdownSyncDecision({
    hasPendingChanges: false,
    synchronizedSnapshot: '# title\n',
    serializedMarkdown: '# title\n',
    baselineBlockCount: 10,
    fidelityBlockLimit: 160,
    fidelityLengthLimit: 120000
  });

  assert.equal(decision, 'skip');
});

test('resolveMarkdownSyncDecision preserves formatting inside fidelity limits', () => {
  const decision = resolveMarkdownSyncDecision({
    hasPendingChanges: true,
    synchronizedSnapshot: '# title\n',
    serializedMarkdown: '## title\n',
    baselineBlockCount: 10,
    fidelityBlockLimit: 160,
    fidelityLengthLimit: 120000
  });

  assert.equal(decision, 'preserve');
});

test('resolveMarkdownSyncDecision falls back to replace for large documents', () => {
  const decision = resolveMarkdownSyncDecision({
    hasPendingChanges: true,
    synchronizedSnapshot: null,
    serializedMarkdown: 'a'.repeat(120001),
    baselineBlockCount: 400,
    fidelityBlockLimit: 160,
    fidelityLengthLimit: 120000
  });

  assert.equal(decision, 'replace');
});

test('synchronizeMarkdownContent reuses preserved markdown for shared sync paths', () => {
  let preserveCalls = 0;

  const result = synchronizeMarkdownContent({
    currentContent: '# title\n',
    hasPendingChanges: true,
    synchronizedSnapshot: '# title\n',
    serializedMarkdown: '## title\n',
    baselineBlockCount: 10,
    fidelityBlockLimit: 160,
    fidelityLengthLimit: 120000,
    preserveContent: () => {
      preserveCalls += 1;
      return 'title\n=====\n';
    }
  });

  assert.equal(result.decision, 'preserve');
  assert.equal(result.nextContent, 'title\n=====\n');
  assert.equal(preserveCalls, 1);
});

test('synchronizeMarkdownContent skips unchanged synchronized markdown without calling preserve', () => {
  let preserveCalls = 0;

  const result = synchronizeMarkdownContent({
    currentContent: '# title\n',
    hasPendingChanges: false,
    synchronizedSnapshot: '# title\n',
    serializedMarkdown: '# title\n',
    baselineBlockCount: 10,
    fidelityBlockLimit: 160,
    fidelityLengthLimit: 120000,
    preserveContent: () => {
      preserveCalls += 1;
      return 'unexpected';
    }
  });

  assert.equal(result.decision, 'skip');
  assert.equal(result.nextContent, '# title\n');
  assert.equal(preserveCalls, 0);
});
