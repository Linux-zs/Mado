import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const themeSelectors = [
  ':root',
  ":root[data-theme='dark']",
  ":root[data-theme='one-dark-pro']",
  ":root[data-theme='dracula']",
  ":root[data-theme='catppuccin-mocha']",
  ":root[data-theme='night-owl']",
  ":root[data-theme='tokyo-night']",
  ":root[data-theme='github-light']"
];

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

function getExactRuleBody(selector) {
  const rulePattern = new RegExp(`(^|})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`, 'm');
  const match = rulePattern.exec(css);
  assert.ok(match, `Missing selector: ${selector}`);
  const bodyStart = match.index + match[0].length;
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

function getLastRuleBody(selector) {
  const start = css.lastIndexOf(`${selector} {`);
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
  for (const selector of themeSelectors) {
    const rule = getRuleBody(selector);
    assert.match(rule, /--color-workspace-surface:\s*#[0-9a-fA-F]{6,8};/);
    assert.match(rule, /--color-sidebar-surface:\s*#[0-9a-fA-F]{6,8};/);
    assert.match(rule, /--color-status-surface:\s*#[0-9a-fA-F]{6,8};/);
    assert.match(rule, /--color-header-surface:\s*#[0-9a-fA-F]{6,8};/);
    assert.match(rule, /--color-input-surface:\s*#[0-9a-fA-F]{6,8};/);
  }
});

test('theme rules define markdown code and syntax color tokens', () => {
  for (const selector of themeSelectors) {
    const rule = getRuleBody(selector);
    for (const token of [
      '--color-inline-code-bg',
      '--color-code-block-bg',
      '--color-table-header-bg',
      '--color-code-comment',
      '--color-code-keyword',
      '--color-code-string',
      '--color-code-title'
    ]) {
      assert.match(rule, new RegExp(`${token}:\\s*[^;]+;`), `${selector} missing ${token}`);
    }
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

test('sidebar file tree and outline use enlarged compact typography', () => {
  assert.match(getExactRuleBody('.file-tree-row'), /color:\s*var\(--color-text-muted\);/);
  assert.doesNotMatch(getExactRuleBody('.file-tree-row.is-active'), /\bcolor\s*:/);
  assert.match(getExactRuleBody('.file-tree-label'), /font-size:\s*15px;/);
  const rootLabelRule = getExactRuleBody('.file-tree-row.is-root .file-tree-label');
  assert.match(rootLabelRule, /font-size:\s*14px;/);
  assert.doesNotMatch(rootLabelRule, /font-weight\s*:/);
  assert.doesNotMatch(rootLabelRule, /\bcolor\s*:/);
  assert.doesNotMatch(css, /\.file-tree-row\.is-folder \.file-tree-label\s*\{[^}]*font-weight/s);
  assert.doesNotMatch(css, /\.file-tree-row\.is-file \.file-tree-label\s*\{[^}]*font-weight/s);
  assert.doesNotMatch(css, /\.file-tree-row\.is-open:not\(\.is-active\)\s*\{[^}]*color/s);

  const outlineListRule = getLastRuleBody('.outline-list');
  const outlineItemRule = getExactRuleBody('.outline-item');
  assert.doesNotMatch(getExactRuleBody('.outline-item.is-active'), /\bcolor\s*:/);
  assert.match(outlineListRule, /gap:\s*2px;/);
  assert.match(outlineItemRule, /padding:\s*5px 10px;/);
  assert.match(outlineItemRule, /font-size:\s*16px;/);
  assert.match(outlineItemRule, /line-height:\s*1\.28;/);
});
