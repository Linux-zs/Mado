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

test('editor surfaces clamp the readable column width to 1280px', () => {
  const rootRule = getRuleBody(':root');
  assert.match(rootRule, /--editor-max-width:\s*1280px;/);

  const sourceShellRule = getRuleBody('.source-editor-shell');
  assert.match(sourceShellRule, /justify-content:\s*center;/);

  const sourceEditorRule = getRuleBody('.source-editor');
  assert.match(sourceEditorRule, /width:\s*min\(100%, var\(--editor-max-width\)\);/);
  assert.match(sourceEditorRule, /margin:\s*0 auto;/);

  const milkdownHostRule = getRuleBody('.milkdown-host');
  assert.match(milkdownHostRule, /justify-content:\s*center;/);

  const milkdownEditorRule = getRuleBody('.milkdown-host .ProseMirror');
  assert.match(milkdownEditorRule, /max-width:\s*var\(--editor-max-width\);/);
  assert.match(milkdownEditorRule, /margin:\s*0 auto;/);
});
