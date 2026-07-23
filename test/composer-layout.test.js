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
