import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rustSource = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

test('rust startup path handling keeps pending external files in a shared queue', () => {
  assert.match(rustSource, /struct PendingOpenPaths\(Mutex<Vec<String>>\)/);
  assert.match(rustSource, /OpenPendingExternalFiles/);
  assert.match(rustSource, /fn take_pending_open_paths/);
  assert.match(rustSource, /tauri_plugin_single_instance::init/);
  assert.match(rustSource, /collect_external_open_paths\(std::env::args\(\)\.skip\(1\)/);
});

test('frontend drains pending external open files on startup and command events', () => {
  assert.match(mainSource, /type:\s*'openPendingExternalFiles'/);
  assert.match(mainSource, /invoke<string\[]>\('take_pending_open_paths'\)/);
  assert.match(mainSource, /case 'openPendingExternalFiles':[\s\S]*flushPendingExternalOpenFiles/);
  assert.match(mainSource, /void flushPendingExternalOpenFiles\(\);/);
});
