'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('file-change summary is a sibling above the prompt card', () => {
  const html = read('renderer/index.html');
  const statusStart = html.indexOf('<div id="composer-change-status"');
  const statusEnd = html.indexOf('</div>', statusStart);
  const composerStart = html.indexOf('<div id="composer-wrap">');
  const composerEnd = html.indexOf('</div>', composerStart);

  assert.ok(statusStart >= 0);
  assert.ok(statusEnd < composerStart);
  assert.ok(composerStart >= 0);
  assert.ok(composerEnd > composerStart);
  assert.equal(
    html.slice(composerStart, composerEnd).includes('id="composer-change-status"'),
    false,
  );
});

test('file-change summary owns independent outer spacing', () => {
  const styles = read('renderer/styles/settings.css');
  assert.match(styles, /#composer-change-status\s*\{[^}]*width:\s*calc\(100% - var\(--space-5\)\)/s);
  assert.match(styles, /#composer-change-status\s*\{[^}]*margin:\s*0 auto var\(--space-1\)/s);
  assert.match(styles, /#composer-change-status\[hidden\]\s*\{\s*display:\s*none/s);
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
