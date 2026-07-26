'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

/**
 * Load sidebar.js in a vm sandbox with a localStorage stub. assignSession
 * only touches localStorage, so no DOM is needed; render paths stay untested.
 */
function loadSidebar() {
  const store = new Map();
  const window = {};
  vm.runInNewContext(read('renderer/js/sidebar.js'), {
    window,
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
    },
    console,
  });
  return { window, store };
}

test('Sidebar exposes assignSession and files a session into its group', () => {
  const { window, store } = loadSidebar();
  store.set(
    'kimi.customGroups',
    JSON.stringify({ groups: [{ id: 'g1', name: 'G', collapsed: false }], assign: {} }),
  );

  assert.equal(typeof window.Sidebar.assignSession, 'function');
  window.Sidebar.assignSession('s1', 'g1');
  let saved = JSON.parse(store.get('kimi.customGroups'));
  assert.equal(saved.assign.s1, 'g1');

  // Re-assigning moves the session; null removes the assignment again.
  window.Sidebar.assignSession('s1', null);
  saved = JSON.parse(store.get('kimi.customGroups'));
  assert.ok(!('s1' in saved.assign));
});

test('assignSession ignores groups that no longer exist', () => {
  const { window, store } = loadSidebar();
  store.set(
    'kimi.customGroups',
    JSON.stringify({ groups: [{ id: 'g1', name: 'G', collapsed: false }], assign: {} }),
  );
  window.Sidebar.assignSession('s1', 'deleted-group');
  const saved = JSON.parse(store.get('kimi.customGroups'));
  assert.ok(!('s1' in saved.assign));
});

test('group headers render a hover new-chat button wired to a grouped draft', () => {
  const sidebar = read('renderer/js/sidebar.js');
  const app = read('renderer/js/app.js');
  const css = read('renderer/styles/layout.css');

  // The '+' sits next to the delete '×' and starts a draft bound to the group.
  assert.match(sidebar, /el\('button', 'custom-group-new-chat', '\+'\)/);
  assert.match(sidebar, /window\.App\?\.startNewChat\?\.\(\{ groupId: group\.id \}\)/);
  assert.match(sidebar, /header\.append\(count, add, del\)/);

  // app.js carries the group through draft mode into the lazy create.
  assert.match(app, /startNewChat\(options\)/);
  assert.match(app, /draftGroupId = options\?\.groupId \|\| null/);
  assert.match(app, /window\.Sidebar\?\.assignSession\?\.\(session\.id, draftGroupId\)/);

  // Same hover reveal as the existing delete action.
  assert.match(css, /\.custom-group-label:hover \.custom-group-new-chat/);
  assert.match(css, /\.custom-group-new-chat:focus-visible/);
});

test('group new-chat title is localized in Korean and English', () => {
  const i18n = read('renderer/js/i18n.js');
  assert.match(i18n, /'sidebar\.group_new_chat_title': '이 그룹에서 새 대화'/);
  assert.match(i18n, /'sidebar\.group_new_chat_title': 'New chat in this group'/);
});
