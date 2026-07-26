'use strict';

/**
 * changes-popover.test.js — DOM harness for the composer changes pill and its
 * popover (renderer/js/panel.js, requirement B). Same hand-rolled DOM stub
 * pattern as permission-pill.test.js (no jsdom in this repo): the real IIFE
 * source runs inside a vm context.
 *
 * Proves:
 *  - a kimi:changes-updated snapshot shows the pill with '파일 N개 변경됨' and
 *    +A/-D stats; a zero-change snapshot hides it again;
 *  - clicking the pill opens a .changes-popover (shared .model-dropdown
 *    chrome) listing each file with a shortened path + per-file stats;
 *  - clicking a file row closes the popover and opens the panel on the
 *    Changes tab with that file selected;
 *  - Escape and outside mousedown close the popover;
 *  - a live snapshot update refills (or closes) the open popover;
 *  - the retired #composer-change-status / #changes-summary-btn hooks are
 *    gone from panel.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(
  path.resolve(__dirname, '..', 'renderer', 'js', 'panel.js'),
  'utf8',
);

/* ---- minimal DOM stub -------------------------------------------------- */

function makeElement(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    children: [],
    parentNode: null,
    className: '',
    hidden: false,
    dataset: {},
    style: {},
    attributes: {},
    listeners: {},
    tabIndex: 0,    classList: {
      _set: new Set(),
      add(...cs) { cs.forEach((c) => this._set.add(c)); },
      remove(...cs) { cs.forEach((c) => this._set.delete(c)); },
      toggle(c, force) {
        const on = force === undefined ? !this._set.has(c) : !!force;
        on ? this._set.add(c) : this._set.delete(c);
        return on;
      },
      contains(c) { return this._set.has(c); },
    },
    append(...kids) { for (const k of kids) el.appendChild(k); },
    appendChild(k) { k.parentNode = el; el.children.push(k); return k; },
    remove() {
      if (el.parentNode) {
        const i = el.parentNode.children.indexOf(el);
        if (i >= 0) el.parentNode.children.splice(i, 1);
        el.parentNode = null;
      }
    },
    contains(node) {
      let cur = node;
      while (cur) {
        if (cur === el) return true;
        cur = cur.parentNode;
      }
      return false;
    },
    addEventListener(type, fn) { (el.listeners[type] ??= []).push(fn); },
    removeEventListener() {},
    setAttribute(name, value) { el.attributes[name] = String(value); },
    removeAttribute(name) { delete el.attributes[name]; },
    getBoundingClientRect() {
      return { left: 20, top: 700, right: 220, bottom: 724, width: 200, height: 24 };
    },
    focus() {},
    click() { for (const fn of el.listeners.click ?? []) fn({ target: el }); },
    // test helpers
    findAll(pred) {
      const out = [];
      const walk = (node) => {
        if (pred(node)) out.push(node);
        for (const k of node.children ?? []) walk(k);
      };
      walk(el);
      return out;
    },
    text() {
      let s = el.textContent ?? '';
      for (const k of el.children) s += k.text();
      return s;
    },
  };
  // Real DOM: assigning textContent replaces all children with a text node.
  let ownText = '';
  Object.defineProperty(el, 'textContent', {
    get() { return ownText; },
    set(v) { ownText = String(v ?? ''); el.children = []; },
  });
  return el;
}

const PANEL_IDS = [
  'panel', 'panel-title', 'panel-close-btn', 'panel-tabs',
  'panel-tab-activity', 'panel-tab-changes', 'panel-tab-change-count',
  'panel-content', 'panel-work', 'panel-status', 'panel-tasks',
  'panel-activity', 'panel-files', 'panel-changes', 'changes-pill',
];

function makeWorld() {
  const byId = Object.fromEntries(PANEL_IDS.map((id) => [id, makeElement(id === 'changes-pill' ? 'button' : 'div')]));
  byId['changes-pill'].hidden = true; // matches index.html

  const body = makeElement('body');
  const doc = {
    body,
    _listeners: {},
    getElementById: (id) => byId[id] ?? null,
    createElement: (tag) => makeElement(tag),
    addEventListener(type, fn) { (doc._listeners[type] ??= []).push(fn); },
    removeEventListener(type, fn) {
      const list = doc._listeners[type] ?? [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
  };

  const window = {
    App: { state: { sessions: [{ id: 'sid1', cwd: '/repo' }], activeSessionId: 'sid1' } },
    I18N: null, // exercise the Korean fallbacks
    kimi: {},   // no listTasks: task polling stays inert
    innerWidth: 1280,
    innerHeight: 800,
    _listeners: {},
    addEventListener(type, fn) { (window._listeners[type] ??= []).push(fn); },
    removeEventListener() {},
  };
  const localStorage = {
    _map: new Map(),
    getItem(k) { return this._map.has(k) ? this._map.get(k) : null; },
    setItem(k, v) { this._map.set(k, String(v)); },
    removeItem(k) { this._map.delete(k); },
  };
  const context = vm.createContext({
    window, document: doc, localStorage, console,
    setTimeout, clearTimeout, Promise,
  });
  vm.runInContext(SRC, context, { filename: 'panel.js' });

  const dispatchSnapshot = (snapshot) => {
    for (const fn of window._listeners['kimi:changes-updated'] ?? []) fn({ detail: snapshot });
  };
  const dispatchDoc = (type, event) => {
    for (const fn of [...(doc._listeners[type] ?? [])]) fn(event);
  };
  const popover = () => body.children.find((c) => c.className.includes('changes-popover')) ?? null;
  return { window, doc, byId, body, dispatchSnapshot, dispatchDoc, popover };
}

function snapshot(fileCount, files) {
  return {
    sessionId: 'sid1',
    fileCount,
    additions: files.reduce((s, f) => s + f.additions, 0),
    deletions: files.reduce((s, f) => s + f.deletions, 0),
    files,
  };
}

const FILE_A = { path: '/repo/src/a.js', oldPath: null, kind: 'edit', state: 'done', additions: 7, deletions: 1, rows: [] };
const FILE_B = {
  path: '/repo/very/long/nested/directory/structure/that/keeps/going/deeper/file-b.ts',
  oldPath: null, kind: 'write', state: 'done', additions: 3, deletions: 2, rows: [],
};

/* ---- tests -------------------------------------------------------------- */

test('snapshot shows the pill with count and stats; zero changes hides it', () => {
  const w = makeWorld();
  const pill = w.byId['changes-pill'];
  assert.equal(pill.hidden, true);

  w.window.Panel.setActiveSession('sid1');
  w.dispatchSnapshot(snapshot(2, [FILE_A, FILE_B]));

  assert.equal(pill.hidden, false);
  assert.match(pill.text(), /파일 2개 변경됨/);
  assert.match(pill.text(), /\+10/);
  assert.match(pill.text(), /-3/);
  assert.equal(w.byId['panel-tab-change-count'].textContent, '2');
  assert.equal(w.byId['panel-tab-change-count'].hidden, false);
  assert.match(pill.attributes['aria-label'] ?? '', /변경사항 검토 열기/);

  w.dispatchSnapshot(snapshot(0, []));
  assert.equal(pill.hidden, true);
  assert.equal(w.byId['panel-tab-change-count'].hidden, true);
});

test('pill click opens a popover listing files with shortened paths and stats', () => {
  const w = makeWorld();
  const pill = w.byId['changes-pill'];
  w.window.Panel.setActiveSession('sid1');
  w.dispatchSnapshot(snapshot(2, [FILE_A, FILE_B]));

  pill.click();
  const pop = w.popover();
  assert.ok(pop, 'popover opens');
  assert.match(pop.className, /model-dropdown changes-popover/);
  assert.equal(pill.attributes['aria-expanded'], 'true');

  const rows = pop.findAll((n) => n.className.includes('changes-popover-file'));
  assert.equal(rows.length, 2);
  assert.match(rows[0].text(), /src\/a\.js/);
  assert.match(rows[0].text(), /\+7/);
  assert.match(rows[0].text(), /-1/);
  // Long path is middle-ellipsized; the full path stays on the tooltip.
  assert.match(rows[1].text(), /…\/file-b\.ts/);
  assert.equal(rows[1].title, FILE_B.path);
});

test('file row click opens the Changes tab on that file and closes the popover', () => {
  const w = makeWorld();
  const pill = w.byId['changes-pill'];
  w.window.Panel.setActiveSession('sid1');
  w.dispatchSnapshot(snapshot(2, [FILE_A, FILE_B]));

  pill.click();
  const rows = w.popover().findAll((n) => n.className.includes('changes-popover-file'));
  rows[1].click();

  assert.equal(w.popover(), null, 'popover closed');
  assert.equal(w.byId.panel.hidden, false, 'panel opened');
  assert.equal(w.byId['panel-changes'].hidden, false, 'changes tab visible');
  assert.equal(w.byId['panel-work'].hidden, true, 'activity tab hidden');
  // The selected file's detail header renders in the Changes tab.
  assert.match(w.byId['panel-changes'].text(), new RegExp(FILE_B.path.replace(/[/.]/g, '\\$&')));
});

test('Escape and outside mousedown close the popover', () => {
  const w = makeWorld();
  const pill = w.byId['changes-pill'];
  w.window.Panel.setActiveSession('sid1');
  w.dispatchSnapshot(snapshot(1, [FILE_A]));

  pill.click();
  assert.ok(w.popover());
  w.dispatchDoc('keydown', { key: 'Escape', stopPropagation() {} });
  assert.equal(w.popover(), null, 'Escape closes');
  assert.equal(pill.attributes['aria-expanded'], 'false');

  pill.click();
  assert.ok(w.popover());
  w.dispatchDoc('mousedown', { target: w.byId['panel-work'] }); // outside pill+popover
  assert.equal(w.popover(), null, 'outside mousedown closes');
});

test('a live snapshot update refills an open popover, or closes it when empty', () => {
  const w = makeWorld();
  const pill = w.byId['changes-pill'];
  w.window.Panel.setActiveSession('sid1');
  w.dispatchSnapshot(snapshot(2, [FILE_A, FILE_B]));

  pill.click();
  assert.equal(w.popover().findAll((n) => n.className.includes('changes-popover-file')).length, 2);

  // A file committed away: the list shrinks in place.
  w.dispatchSnapshot(snapshot(1, [FILE_A]));
  const rows = w.popover().findAll((n) => n.className.includes('changes-popover-file'));
  assert.equal(rows.length, 1);
  assert.match(rows[0].text(), /src\/a\.js/);

  // Everything committed: the popover closes with the pill hidden.
  w.dispatchSnapshot(snapshot(0, []));
  assert.equal(w.popover(), null);
  assert.equal(pill.hidden, true);
});

test('switching sessions closes an open popover', () => {
  const w = makeWorld();
  w.window.Panel.setActiveSession('sid1');
  w.dispatchSnapshot(snapshot(1, [FILE_A]));
  w.byId['changes-pill'].click();
  assert.ok(w.popover());

  w.window.Panel.setActiveSession('sid2');
  assert.equal(w.popover(), null, 'popover belongs to the previous session');
});

test('retired change-strip hooks are gone from panel.js', () => {
  assert.equal(SRC.includes('changes-summary-btn'), false);
  assert.equal(SRC.includes('composer-change-status'), false);
});
