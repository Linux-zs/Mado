import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

test('status bar renders the current editor scale percentage', () => {
  assert.match(mainSource, /scaleLabel\.textContent = `\$\{editorScalePercent\}%`;/);
  assert.match(mainSource, /scaleLabel\.title\s*=/);
  assert.match(mainSource, /statusBarRight\.append\(lineCountLabel, charCountLabel, scaleLabel\);/);
});
