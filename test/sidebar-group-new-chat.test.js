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

test('a pending group draft marks its target group in the sidebar', () => {
  const sidebar = read('renderer/js/sidebar.js');
  const css = read('renderer/styles/layout.css');

  // Group header gets a '새 대화' badge; the container an accent highlight.
  assert.match(sidebar, /window\.App\?\.getDraftGroupId\?\.\(\) === group\.id/);
  assert.match(sidebar, /el\('span', 'custom-group-draft-badge', T\('sidebar\.group_draft_badge'/);
  assert.match(sidebar, /groupEl\.classList\.add\('draft-target'\)/);
  assert.match(css, /\.custom-group\.draft-target > \.session-group-label/);
  assert.match(css, /\.custom-group-draft-badge/);
});

test('draft target badge is localized in Korean and English', () => {
  const i18n = read('renderer/js/i18n.js');
  assert.match(i18n, /'sidebar\.group_draft_badge': '새 대화'/);
  assert.match(i18n, /'sidebar\.group_draft_badge': 'New chat'/);
  assert.match(i18n, /'workspace\.group': '그룹'/);
  assert.match(i18n, /'workspace\.group': 'Group'/);
});

test('getGroupName resolves names for the draft-target chip', () => {
  const { window, store } = loadSidebar();
  store.set(
    'kimi.customGroups',
    JSON.stringify({ groups: [{ id: 'g1', name: 'G', collapsed: false }], assign: {} }),
  );

  assert.equal(window.Sidebar.getGroupName('g1'), 'G');
  // Unknown / missing ids resolve to undefined so the chip stays hidden.
  assert.equal(window.Sidebar.getGroupName('deleted-group'), undefined);
  assert.equal(window.Sidebar.getGroupName(null), undefined);
});

test('the draft chat view shows the target group chip', () => {
  const app = read('renderer/js/app.js');
  const html = read('renderer/index.html');
  const css = read('renderer/styles/settings.css');

  // app.js exposes the pending draft group only while in draft mode and
  // syncs the chip on every draft entry.
  assert.match(app, /getDraftGroupId\(\) \{\s*return App\.state\.activeId \? null : draftGroupId;/);
  assert.match(app, /function syncDraftGroupChip\(\)/);
  assert.match(app, /window\.Sidebar\?\.getGroupName\?\.\(draftGroupId\)/);

  assert.match(html, /id="draft-group-chip"/);
  assert.match(html, /data-i18n="workspace\.group"/);
  assert.match(css, /#draft-context:has\(#draft-group-chip:not\(\[hidden\]\)\)/);
});

test('group header action buttons keep a safe gap', () => {
  const css = read('renderer/styles/layout.css');
  // The destructive '×' gets an extra margin on top of the label's flex gap.
  assert.match(css, /\.custom-group-delete \{\s*margin-left: var\(--space-1\);\s*\}/);
});
