import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

function getRootVariable(name) {
  const match = css.match(new RegExp(`${name}:\\s*([^;]+);`));
  assert.ok(match, `Missing CSS variable ${name}`);
  return match[1].trim();
}

test('default ui body and heading fonts use Chinese sans-first stacks', () => {
  assert.equal(
    getRootVariable('--font-ui'),
    "'Microsoft YaHei UI', 'Segoe UI', 'PingFang SC', 'Noto Sans CJK SC', sans-serif"
  );
  assert.equal(
    getRootVariable('--font-body'),
    "'Microsoft YaHei UI', 'Segoe UI', 'PingFang SC', 'Noto Sans CJK SC', sans-serif"
  );
  assert.equal(
    getRootVariable('--font-heading'),
    "'Microsoft YaHei UI', 'Segoe UI', 'PingFang SC', 'Noto Sans CJK SC', sans-serif"
  );
});

test('default code font remains monospace and separate from body fonts', () => {
  assert.equal(
    getRootVariable('--font-code'),
    "Consolas, 'Cascadia Code', 'Microsoft YaHei UI', monospace"
  );
});
