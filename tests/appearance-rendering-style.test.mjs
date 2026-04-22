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

test('clear type critical surfaces use opaque theme colors', () => {
  const rootRule = getRuleBody(':root');
  const darkRootRule = getRuleBody(":root[data-theme='dark']");

  for (const rule of [rootRule, darkRootRule]) {
    assert.match(rule, /--color-workspace-surface:\s*#[0-9a-fA-F]{6,8};/);
    assert.match(rule, /--color-sidebar-surface:\s*#[0-9a-fA-F]{6,8};/);
    assert.match(rule, /--color-status-surface:\s*#[0-9a-fA-F]{6,8};/);
    assert.match(rule, /--color-header-surface:\s*#[0-9a-fA-F]{6,8};/);
    assert.match(rule, /--color-input-surface:\s*#[0-9a-fA-F]{6,8};/);
  }
});

test('text-heavy panels avoid opacity and transform transitions', () => {
  const sidebarViewRule = getRuleBody('.sidebar-view');
  const editorSurfaceRule = getRuleBody('.editor-surface');

  for (const rule of [sidebarViewRule, editorSurfaceRule]) {
    assert.doesNotMatch(rule, /\bopacity\s*:/);
    assert.doesNotMatch(rule, /\btransform\s*:/);
    assert.doesNotMatch(rule, /transition\s*:[^;]*opacity/);
    assert.doesNotMatch(rule, /transition\s*:[^;]*transform/);
  }
});
