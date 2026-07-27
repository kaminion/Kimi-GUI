'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('scheduled cards are re-appended after every top-level transcript append', () => {
  const chat = read('renderer/js/chat.js');

  // The invariant is documented where the helper lives.
  assert.match(chat, /INVARIANT: scheduled cards are ALWAYS the last transcript rows/);
  assert.match(chat, /for \(const echo of consumedEchoes\) transcriptEl\.append\(echo\.el\)/);
  assert.match(chat, /for \(const card of scheduledCards\) transcriptEl\.append\(card\.el\)/);

  // Every row appended above the cards moves them back to the bottom: the
  // live 'working' row, the optimistic user echo, late message rows, and
  // system notes.
  assert.match(chat, /row\.append\(box, changeWrap, textWrap\);\s*transcriptEl\.append\(row\);\s*reappendScheduledCards\(\)/);
  assert.match(chat, /msg-user msg-optimistic'\);\s*row\.append\(el\('div', 'msg-user-text', text\)\);\s*transcriptEl\.append\(row\);\s*reappendScheduledCards\(\)/);
  assert.match(chat, /fillMessage\(row, m, collectResults\(\), busy\);\s*transcriptEl\.append\(row\);\s*reappendScheduledCards\(\)/);
  assert.match(chat, /msg-system-text', text\)\);\s*transcriptEl\.append\(row\);\s*reappendScheduledCards\(\)/);
});

test('question options separate the radio glyph from its text', () => {
  const css = read('renderer/styles/components.css');

  assert.match(css, /\.modal label\.question-option \{[^}]*display: flex;/s);
  assert.match(css, /\.modal label\.question-option \{[^}]*gap: var\(--space-2\);/s);
  assert.match(css, /\.question-option input\[type="radio"\],\s*\.question-option input\[type="checkbox"\] \{\s*flex: none;/s);
  assert.match(css, /\.question-option-texts \{/s);
  assert.match(css, /\.question-option-badge \{/s);
});
