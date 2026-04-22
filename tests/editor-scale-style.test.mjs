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

test('editor viewport uses runtime zoom with layout compensation', () => {
  const rootRule = getRuleBody(':root');
  const editorViewportRule = getRuleBody('.editor-viewport');

  assert.match(rootRule, /--editor-scale:\s*1;/);
  assert.match(editorViewportRule, /zoom:\s*var\(--editor-scale\);/);
  assert.match(editorViewportRule, /width:\s*calc\(100%\s*\/\s*var\(--editor-scale\)\);/);
  assert.match(editorViewportRule, /height:\s*calc\(100%\s*\/\s*var\(--editor-scale\)\);/);
});
