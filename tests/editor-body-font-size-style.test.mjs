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

test('editor body text uses 17px baseline while source editor remains unchanged', () => {
  assert.match(getRuleBody('.milkdown-host .ProseMirror'), /font:\s*17px\/1\.78 var\(--font-body\);/);
  assert.match(getRuleBody('.viewer-line'), /font:\s*17px\/1\.76 var\(--font-body\);/);
  assert.match(getRuleBody('.source-editor'), /font:\s*13px\/1\.72 var\(--font-code\);/);
});
