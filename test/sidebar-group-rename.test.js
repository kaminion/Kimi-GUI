'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('group headers render a hover rename button wired to the inline name edit', () => {
  const sidebar = read('renderer/js/sidebar.js');

  // The pencil rides in the hover action wrapper between '+' and '×'.
  assert.match(sidebar, /el\('button', 'custom-group-rename'\)/);
  assert.match(sidebar, /rename\.innerHTML = pencilSvg\(\)/);
  assert.match(sidebar, /actions\.append\(add, rename, del\)/);

  // Clicking it enters the same inline edit as double-clicking the name.
  assert.match(
    sidebar,
    /rename\.addEventListener\('click', \(e\) => \{\s*e\.stopPropagation\(\);\s*editingGroupId = group\.id;\s*rerender\(\);\s*\}\)/,
  );
});

test('group action buttons share one size and the hover swap', () => {
  const css = read('renderer/styles/layout.css');

  // Wrapper revealed on hover / keyboard focus; the count hides instead.
  assert.match(css, /\.custom-group-actions \{[^}]*display: none;/s);
  assert.match(css, /\.custom-group-label:hover \.custom-group-actions,\s*\.custom-group-actions:focus-within \{\s*display: inline-flex;\s*\}/);
  // …and the wrapper pins itself to the right edge without the count.
  assert.match(css, /\.custom-group-actions \{[^}]*margin-left: auto;/s);

  // One uniform button geometry (no per-button font-size drift).
  assert.match(css, /\.custom-group-delete,\s*\.custom-group-new-chat,\s*\.custom-group-rename \{[^}]*width: 18px;[^}]*height: 18px;[^}]*font-size: 13px;/s);
  assert.match(css, /\.custom-group-new-chat:hover,\s*\.custom-group-rename:hover/);
  assert.equal(/\.custom-group-new-chat \{\s*font-size/.test(css), false);
});

test('group rename button reuses the localized rename label', () => {
  const sidebar = read('renderer/js/sidebar.js');
  const i18n = read('renderer/js/i18n.js');

  assert.match(sidebar, /rename\.title = T\('sidebar\.group_rename_aria'/);
  assert.match(i18n, /'sidebar\.group_rename_aria': '그룹 이름 변경'/);
  assert.match(i18n, /'sidebar\.group_rename_aria': 'Rename group'/);
});
