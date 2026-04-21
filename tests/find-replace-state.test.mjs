import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeFindMatchActiveIndex,
  findNearestFindMatchIndex,
  getFindMatchStart
} from '../.test-dist/src/find-replace-state.js';

test('computeFindMatchActiveIndex resets to the first match when requested', () => {
  const matches = [
    { kind: 'source', start: 4, end: 7 },
    { kind: 'source', start: 12, end: 15 }
  ];

  const nextIndex = computeFindMatchActiveIndex(matches, {
    resetActive: true,
    previousActiveIndex: 1,
    previousActiveMatch: matches[1]
  });

  assert.equal(nextIndex, 0);
});

test('computeFindMatchActiveIndex keeps the exact active match after recompute', () => {
  const previousActiveMatch = { kind: 'rendered', from: 12, to: 16 };
  const matches = [
    { kind: 'rendered', from: 3, to: 7 },
    previousActiveMatch,
    { kind: 'rendered', from: 22, to: 27 }
  ];

  const nextIndex = computeFindMatchActiveIndex(matches, {
    previousActiveIndex: 0,
    previousActiveMatch
  });

  assert.equal(nextIndex, 1);
});

test('computeFindMatchActiveIndex moves to the nearest next match when the old one disappears', () => {
  const previousActiveMatch = { kind: 'source', start: 10, end: 14 };
  const matches = [
    { kind: 'source', start: 2, end: 6 },
    { kind: 'source', start: 18, end: 22 },
    { kind: 'source', start: 30, end: 34 }
  ];

  const nextIndex = computeFindMatchActiveIndex(matches, {
    previousActiveIndex: 1,
    previousActiveMatch,
    direction: 1
  });

  assert.equal(nextIndex, 1);
  assert.equal(getFindMatchStart(matches[nextIndex]), 18);
});

test('findNearestFindMatchIndex wraps to the last match when navigating backward before the first match', () => {
  const matches = [
    { kind: 'rendered', from: 5, to: 9 },
    { kind: 'rendered', from: 15, to: 20 },
    { kind: 'rendered', from: 30, to: 34 }
  ];

  assert.equal(findNearestFindMatchIndex(matches, 1, -1), 2);
});
