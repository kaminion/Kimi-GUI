'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('changes pill floats above the composer, outside the options row', () => {
  const html = read('renderer/index.html');
  const styles = read('renderer/styles/settings.css');

  // v9: the strip above the composer was replaced by a pill; v10: the pill
  // left the options row and floats just above the composer.
  assert.equal(html.includes('composer-change-status'), false);
  assert.equal(html.includes('changes-summary-btn'), false);

  const rowStart = html.indexOf('<div id="composer-options">');
  const rowEnd = html.indexOf('id="branch-indicator"', rowStart);
  assert.ok(rowStart >= 0 && rowEnd > rowStart);
  const row = html.slice(rowStart, rowEnd);
  assert.equal(row.includes('id="changes-pill"'), false, 'pill is out of the options row');

  // …but still present in the composer wrap, hidden until changes exist.
  assert.match(html, /id="changes-pill" class="pill" type="button" hidden/);
  assert.match(html, /id="changes-pill"[^>]*aria-haspopup="true"/);

  // Floating popup chrome: anchored above the wrap, centered, shadowed.
  assert.match(styles, /#changes-pill \{[^}]*position: absolute;[^}]*bottom: calc\(100% \+ 4px\);/s);
  assert.match(styles, /#changes-pill \{[^}]*left: 50%;[^}]*transform: translateX\(-50%\);/s);
  assert.match(styles, /#changes-pill \{[^}]*box-shadow: var\(--shadow-card\);/s);
});

test('changes popover reuses the dropdown chrome; strip styles are removed', () => {
  const styles = read('renderer/styles/settings.css');
  const panel = read('renderer/js/panel.js');

  assert.equal(styles.includes('#composer-change-status'), false);
  assert.equal(styles.includes('changes-summary-btn'), false);
  // Popover: same .model-dropdown chrome as the option dropdowns, plus rows.
  assert.match(panel, /'model-dropdown changes-popover'/);
  assert.match(styles, /\.changes-popover\s*\{[^}]*max-width/s);
  assert.match(styles, /\.changes-popover-path\s*\{[^}]*text-overflow:\s*ellipsis/s);
  assert.match(styles, /\.changes-popover-stats\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s);
});

test('one composer button morphs between SEND, STOP, and SCHEDULE', () => {
  const html = read('renderer/index.html');
  const chat = read('renderer/js/chat.js');
  const styles = read('renderer/styles/components.css');

  // No separate abort button: #send-btn carries all three faces.
  assert.equal(html.includes('id="composer-abort-btn"'), false);
  assert.equal(html.includes('id="send-btn"'), true);
  assert.match(styles, /#send-btn\.stop-mode\s*\{[^}]*background:\s*var\(--danger-soft\)/s);
  assert.match(chat, /classList\.toggle\('stop-mode', stopping\)/);
  // STOP fires only while the composer is empty mid-turn; typing restores SEND.
  assert.match(chat, /busy && !readOnly && !composerEl\.value\.trim\(\)/);
});

test('busy sends park as scheduled messages, never implicit steers', () => {
  const chat = read('renderer/js/chat.js');

  assert.match(chat, /app\.scheduleMessage\(text\)/);
  assert.match(chat, /appendScheduledCard\(text\)/);
  assert.match(chat, /case 'scheduled\.updated':/);
  assert.match(chat, /T\('chat\.scheduled_pending', '예약된 메시지'\)/);
  // Card actions: edit / run-now / cancel.
  assert.match(chat, /T\('chat\.scheduled_run', '바로 실행'\)/);
  assert.match(chat, /T\('chat\.scheduled_cancel', '취소'\)/);
  // Session-switch restore + per-session composer drafts.
  assert.match(chat, /restoreScheduledCards\(activeSessionId\)/);
  assert.match(chat, /swapComposerDraft\(sessionId\)/);
  assert.equal(chat.includes('chat.steer_placeholder'), false);
});

test('composer options order: model, thinking, permission, then swarm (v7)', () => {
  const html = read('renderer/index.html');
  const rowStart = html.indexOf('<div id="composer-options">');
  const rowEnd = html.indexOf('id="branch-indicator"', rowStart);
  assert.ok(rowStart >= 0 && rowEnd > rowStart);
  const row = html.slice(rowStart, rowEnd);
  // model+thinking shape the answer, permission gates tool approval, swarm
  // rides last (cli-only; renders inert under the direct engine).
  const ids = ['id="model-select"', 'id="effort-select"', 'id="permission-select"', 'id="swarm-toggle"'];
  const positions = ids.map((marker) => row.indexOf(marker));
  assert.ok(positions.every((p) => p >= 0));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});
