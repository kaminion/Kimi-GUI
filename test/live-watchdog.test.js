'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('a send arms a REST watchdog that only fires when no live activity follows', () => {
  const chat = read('renderer/js/chat.js');

  // Armed from doSend's idle-send branch; disarmed by live activity and by
  // session switches (renderMessages / reset).
  assert.match(chat, /setBusy\(true\);.*\n.*armLiveWatchdog\(\)/);
  assert.match(chat, /disarmLiveWatchdog\(\); \/\/ live events are flowing/);
  assert.match(chat, /function armLiveWatchdog\(\)/);
  assert.match(chat, /if \(!busy \|\| liveStreams\.size\) return;/);
  assert.match(chat, /scheduleReload\(\);\s*if \(\+\+liveWatchdogRetries < 3\)/);
});

test('opening the changes popover re-verifies committed files first', () => {
  const panel = read('renderer/js/panel.js');
  const chat = read('renderer/js/chat.js');

  // Chat exposes the filter refresh; the popover invokes it before listing.
  assert.match(chat, /refreshChangeFilter: \(\) => void refreshChangeFilter\(\)/);
  assert.match(panel, /void window\.Chat\?\.refreshChangeFilter\?\.\(\);\s*popover = el\('div', 'model-dropdown changes-popover'\)/);
});
