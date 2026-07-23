'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('launch splash remains until the first session history is ready', () => {
  const onboarding = read('renderer/js/onboarding.js');
  const app = read('renderer/js/app.js');

  const finish = onboarding.slice(
    onboarding.indexOf('async function finish()'),
    onboarding.indexOf('async function init(launchApp)'),
  );
  assert.ok(finish.indexOf('if (fn) await fn()') >= 0);
  assert.ok(finish.indexOf('if (root) root.hidden = true') > finish.indexOf('if (fn) await fn()'));
  assert.ok(finish.indexOf('await hideSplash()') > finish.indexOf('if (fn) await fn()'));

  const boot = app.slice(app.indexOf('async function bootMain()'));
  const subscribe = boot.indexOf('window.kimi.onEvent(handleEvent)');
  const sidebarLoading = boot.indexOf('window.Sidebar?.renderLoading?.()');
  const listSessions = boot.indexOf('window.kimi.listSessions()');
  const firstSession = boot.indexOf('await App.selectSession(sorted[0].id)');
  assert.ok(subscribe >= 0);
  assert.ok(sidebarLoading > subscribe);
  assert.ok(listSessions > sidebarLoading);
  assert.ok(firstSession > listSessions);
});

test('slow conversation reads use a delayed, accessible skeleton', () => {
  const chat = read('renderer/js/chat.js');
  const css = read('renderer/styles/layout.css');

  assert.match(chat, /const HISTORY_LOADING_DELAY_MS = 120/);
  assert.match(chat, /function beginLoading\(sessionId\)/);
  assert.match(chat, /T\('chat\.loading_history'/);
  assert.match(chat, /window\.Chat = \{[\s\S]*beginLoading,[\s\S]*renderLoadError,/);
  assert.match(css, /\.transcript-loading/);
  assert.match(css, /@keyframes loading-skeleton-pulse/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('splash idle motion is compositor-friendly and reduced-motion aware', () => {
  const css = read('renderer/styles/onboarding.css');
  const start = css.indexOf('@keyframes splash-cursor-idle');
  const end = css.indexOf('/* Exit quickly', start);
  const idleAnimation = css.slice(start, end);

  assert.ok(start >= 0);
  assert.match(idleAnimation, /opacity:/);
  assert.match(idleAnimation, /transform:/);
  assert.doesNotMatch(idleAnimation, /\b(?:top|left|width|height|margin|padding):/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\.splash-mark-cursor/);
});
