'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('group headers render a hover rename button wired to the inline name edit', () => {
  const sidebar = read('renderer/js/sidebar.js');

  // The pencil sits between the '+' and the '×' and reuses pencilSvg().
  assert.match(sidebar, /el\('button', 'custom-group-rename'\)/);
  assert.match(sidebar, /rename\.innerHTML = pencilSvg\(\)/);
  assert.match(sidebar, /header\.append\(count, add, rename, del\)/);

  // Clicking it enters the same inline edit as double-clicking the name.
  assert.match(
    sidebar,
    /rename\.addEventListener\('click', \(e\) => \{\s*e\.stopPropagation\(\);\s*editingGroupId = group\.id;\s*rerender\(\);\s*\}\)/,
  );
});

test('group rename button shares the hover reveal and hover chrome', () => {
  const css = read('renderer/styles/layout.css');

  assert.match(css, /\.custom-group-label:hover \.custom-group-rename/);
  assert.match(css, /\.custom-group-rename:focus-visible/);
  assert.match(css, /\.custom-group-rename\s*\{[^}]*opacity: 0/s);
  assert.match(css, /\.custom-group-new-chat:hover,\s*\.custom-group-rename:hover/);
});

test('group rename button reuses the localized rename label', () => {
  const sidebar = read('renderer/js/sidebar.js');
  const i18n = read('renderer/js/i18n.js');

  assert.match(sidebar, /rename\.title = T\('sidebar\.group_rename_aria'/);
  assert.match(i18n, /'sidebar\.group_rename_aria': '그룹 이름 변경'/);
  assert.match(i18n, /'sidebar\.group_rename_aria': 'Rename group'/);
});
