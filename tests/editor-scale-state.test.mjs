import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDefaultEditorScalePercent,
  normalizeEditorScalePercent,
  resolveEditorScaleFactor,
  stepEditorScalePercent,
  shouldHandleEditorScaleWheel,
  resetEditorScalePercent
} from '../.test-dist/src/editor-scale-state.js';

test('editor scale defaults to 100 percent', () => {
  assert.equal(createDefaultEditorScalePercent(), 100);
  assert.equal(resetEditorScalePercent(), 100);
});

test('normalizeEditorScalePercent clamps invalid values into 70 to 130 percent', () => {
  assert.equal(normalizeEditorScalePercent(95), 95);
  assert.equal(normalizeEditorScalePercent(10), 70);
  assert.equal(normalizeEditorScalePercent(200), 130);
  assert.equal(normalizeEditorScalePercent(Number.NaN), 100);
});

test('stepEditorScalePercent applies 5 percent wheel steps with clamping', () => {
  assert.equal(stepEditorScalePercent(100, -120), 105);
  assert.equal(stepEditorScalePercent(100, 120), 95);
  assert.equal(stepEditorScalePercent(130, -120), 130);
  assert.equal(stepEditorScalePercent(70, 120), 70);
});

test('resolveEditorScaleFactor converts percent into webview zoom factor', () => {
  assert.equal(resolveEditorScaleFactor(100), 1);
  assert.equal(resolveEditorScaleFactor(70), 0.7);
  assert.equal(resolveEditorScaleFactor(130), 1.3);
});

test('shouldHandleEditorScaleWheel requires ctrl and an in-app target', () => {
  assert.equal(shouldHandleEditorScaleWheel({ ctrlKey: true, targetWithinApp: true }), true);
  assert.equal(shouldHandleEditorScaleWheel({ ctrlKey: false, targetWithinApp: true }), false);
  assert.equal(shouldHandleEditorScaleWheel({ ctrlKey: true, targetWithinApp: false }), false);
});
