import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

function getRuleBody(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `Missing selector: ${selector}`);
  const bodyStart = css.indexOf('{', start) + 1;
  let depth = 1;
  let index = bodyStart;

  while (index < css.length && depth > 0) {
    const character = css[index];
    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
    }
    index += 1;
  }

  return css.slice(bodyStart, index - 1);
}

test('editor styles no longer rely on local css zoom scaling', () => {
  assert.doesNotMatch(css, /--editor-scale:\s*1;/);
  assert.doesNotMatch(css, /\.editor-viewport\s*\{/);
  assert.doesNotMatch(css, /\bzoom:\s*var\(--editor-scale\);/);
});
