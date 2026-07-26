'use strict';

/**
 * motion-polish.test.js — source assertions for the animation additions
 * (emil-design-eng pass): five seams that teleported before now animate
 * with the shared motion tokens (base.css --ease-out), transform/opacity
 * only, never scale(0), exits faster than enters, and prefers-reduced-motion
 * handling that keeps the opacity fade while dropping movement.
 */

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('settings modal card enters with the shared modal-pop settle', () => {
  const styles = read('renderer/styles/settings.css');
  assert.match(styles, /\.settings-modal\s*\{[^}]*animation:\s*modal-pop 0\.18s var\(--ease-out\)/s);
  // Reduced motion: fade kept (modal-fade), scale dropped, real duration
  // restored against the global kill-switch.
  assert.match(styles, /\.settings-modal\s*\{\s*animation:\s*modal-fade 140ms ease-out !important;/s);
});

test('model dropdown grows from its pill, never from scale(0)', () => {
  const styles = read('renderer/styles/settings.css');
  const js = read('renderer/js/chat-options.js');

  assert.match(styles, /\.model-dropdown\s*\{[^}]*transform-origin:\s*top left/s);
  assert.match(styles, /\.model-dropdown\s*\{[^}]*animation:\s*model-dropdown-in 0\.15s var\(--ease-out\)/s);

  const keyframes = styles.match(/@keyframes model-dropdown-in\s*\{([\s\S]*?)\n\}/);
  assert.ok(keyframes, 'model-dropdown-in keyframes exist');
  assert.match(keyframes[1], /opacity:\s*0/);
  assert.match(keyframes[1], /transform:\s*scale\(0\.97\)/);
  assert.equal(keyframes[1].includes('scale(0)'), false, 'never animate from scale(0)');

  // placeDropdown() flips the origin when the list opens upward.
  assert.match(js, /transformOrigin = flipped \? 'bottom left' : 'top left'/);

  assert.match(styles, /\.model-dropdown\s*\{\s*animation:\s*modal-fade 140ms ease-out !important;/s);
});

test('unassign zone fades+rises on [hidden], exit faster than enter', () => {
  const styles = read('renderer/styles/layout.css');

  const base = styles.match(/#group-unassign-zone\s*\{([^}]*)\}/s);
  assert.ok(base, 'zone base rule exists');
  assert.match(base[1], /transition-behavior:\s*allow-discrete/);
  assert.match(base[1], /transition-timing-function:\s*var\(--ease-out\)/);
  const enter = Number(base[1].match(/transition-duration:\s*(\d+)ms/)[1]);

  const hidden = styles.match(/#group-unassign-zone\[hidden\]\s*\{([^}]*)\}/s);
  assert.ok(hidden, 'zone hidden rule exists');
  assert.match(hidden[1], /display:\s*none/);
  assert.match(hidden[1], /opacity:\s*0/);
  assert.match(hidden[1], /transform:\s*translateY\(6px\)/);
  const exit = Number(hidden[1].match(/transition-duration:\s*(\d+)ms/)[1]);

  assert.ok(exit < enter, `exit (${exit}ms) must be faster than enter (${enter}ms)`);

  // Reduced motion: movement dropped, fade kept.
  const reduced = styles.slice(styles.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /#group-unassign-zone\[hidden\]\s*\{[^}]*transform:\s*none/s);
});

test('composer option pills fade in when engine capabilities unhide them', () => {
  const styles = read('renderer/styles/settings.css');
  assert.match(styles, /#composer-options \.pill\s*\{[^}]*transition-property:\s*opacity, display/s);
  assert.match(styles, /#composer-options \.pill\s*\{[^}]*transition-behavior:\s*allow-discrete/s);
  assert.match(styles, /#composer-options \.pill\[hidden\]\s*\{\s*opacity:\s*0/s);
});

test('composer change status fades in/out instead of teleporting', () => {
  const styles = read('renderer/styles/settings.css');
  assert.match(styles, /#composer-change-status\s*\{[^}]*transition-property:\s*opacity, display/s);
  assert.match(styles, /#composer-change-status\s*\{[^}]*transition-behavior:\s*allow-discrete/s);
  // display:none stays the first declaration (composer-layout.test.js pins it).
  assert.match(styles, /#composer-change-status\[hidden\]\s*\{\s*display:\s*none;\s*opacity:\s*0/s);
});
