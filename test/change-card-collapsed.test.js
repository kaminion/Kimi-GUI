'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('file-change cards render collapsed by default', () => {
  const chat = read('renderer/js/chat.js');

  // The diff opens only on demand; the old first-card-open default is gone.
  assert.match(chat, /if \(hasBody\) card\.open = false;/);
  assert.equal(chat.includes('card.open = total === 1 || index === 0'), false);
});

test('live rebuilds still preserve user-toggled card state', () => {
  const chat = read('renderer/js/chat.js');

  // tool.result rebuild copies each card's open flag across the swap.
  assert.match(chat, /changeOpen\.set\(card\.dataset\.changePath \|\| '', card\.open\)/);
  assert.match(chat, /card\.open = changeOpen\.get\(card\.dataset\.changePath \|\| ''\)/);
});
