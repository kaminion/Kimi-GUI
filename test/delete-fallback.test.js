'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('daemon archive failure falls back to a local hide', () => {
  const backend = read('main/backend.js');

  // The daemon's 40409 (workspace root gone, observed after a daemon restart)
  // no longer strands the session: archive failure hides the id locally.
  assert.match(backend, /catch \(err\) \{\s*\/\/ The daemon refuses sessions whose workspace dir vanished/);
  assert.match(backend, /hideSessionId\(sessionId\);/);
  assert.match(backend, /return \{ archived: true, local: true \};/);
  // The CLI-tree state.json marker stays a best-effort nicety.
  assert.match(backend, /try \{ await cliSessions\.archive\(sessionId\); \} catch/);
});

test('the local deleted-id set persists and filters the session list', () => {
  const backend = read('main/backend.js');

  assert.match(backend, /deleted-sessions\.json/);
  assert.match(backend, /function readDeletedIds\(\)/);
  assert.match(backend, /function hideSessionId\(sessionId\)/);
  assert.match(backend, /!s\.archived && !readDeletedIds\(\)\.has\(s\.id\)/);
});
