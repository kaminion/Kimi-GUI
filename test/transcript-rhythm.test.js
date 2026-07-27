'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('consecutive assistant chunks stay visually attached to one turn', () => {
  const chat = read('renderer/js/chat.js');
  const layout = read('renderer/styles/layout.css');
  const components = read('renderer/styles/components.css');

  assert.match(chat, /row\.classList\.add\('msg-assistant-row'\)/);
  assert.match(chat, /msg-row msg-live msg-assistant-row/);
  assert.match(
    layout,
    /#transcript > \.msg-assistant-row \+ \.msg-assistant-row \{\s*margin-top: var\(--space-2\)/,
  );
  assert.match(
    components,
    /\.msg-process \{\s*margin-bottom: var\(--space-1\)/,
  );
});

test('user turns retain the larger transcript boundary', () => {
  const layout = read('renderer/styles/layout.css');

  assert.match(layout, /#transcript > \* \+ \* \{\s*margin-top: var\(--space-3\)/);
  assert.match(
    layout,
    /#transcript > \.msg-user:not\(:first-child\) \{\s*margin-top: var\(--space-4\)/,
  );
});
