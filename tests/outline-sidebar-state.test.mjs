import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

function getFunctionBody(name) {
  const start = mainSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Missing function: ${name}`);
  const bodyStart = mainSource.indexOf('{', start) + 1;
  let depth = 1;
  let index = bodyStart;

  while (index < mainSource.length && depth > 0) {
    const character = mainSource[index];
    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
    }
    index += 1;
  }

  return mainSource.slice(bodyStart, index - 1);
}

test('outline empty state clears stale outline rows and keyed cache', () => {
  const body = getFunctionBody('setOutlineSidebarEmptyState');
  assert.match(body, /outlineSidebarList\.hidden\s*=\s*true;/);
  assert.match(body, /outlineSidebarList\.replaceChildren\(\);/);
  assert.match(body, /outlineItemNodeCache\.clear\(\);/);
});
