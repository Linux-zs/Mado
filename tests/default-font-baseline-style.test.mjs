import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

function getRootVariable(name) {
  const match = css.match(new RegExp(`${name}:\\s*([^;]+);`));
  assert.ok(match, `Missing CSS variable ${name}`);
  return match[1].trim();
}

test('default ui body and heading fonts use system-first sans stacks', () => {
  assert.equal(
    getRootVariable('--font-ui'),
    "'Segoe UI Variable Text', 'Segoe UI Variable', 'Segoe UI', 'Microsoft YaHei UI', 'PingFang SC', 'Noto Sans CJK SC', sans-serif"
  );
  assert.equal(
    getRootVariable('--font-body'),
    "'Segoe UI Variable Text', 'Segoe UI Variable', 'Segoe UI', 'Microsoft YaHei UI', 'PingFang SC', 'Noto Sans CJK SC', sans-serif"
  );
  assert.equal(
    getRootVariable('--font-heading'),
    "'Segoe UI Variable Text', 'Segoe UI Variable', 'Segoe UI', 'Microsoft YaHei UI', 'PingFang SC', 'Noto Sans CJK SC', sans-serif"
  );
});

test('default code font remains monospace and separate from body fonts', () => {
  assert.equal(
    getRootVariable('--font-code'),
    "'Cascadia Code', Consolas, 'Segoe UI Variable Text', 'Segoe UI', 'Microsoft YaHei UI', monospace"
  );
});
