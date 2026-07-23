'use strict';

/**
 * permission-pill.test.js — DOM harness for the #permission-select pill
 * (renderer/js/chat-options.js). jsdom is not a dependency of this repo, so
 * this harness provides a minimal hand-rolled DOM stub (elements, classList,
 * dataset, localStorage) and runs the real IIFE source inside a vm context.
 *
 * Proves, per engine:
 *  - the pill becomes visible on init (both engines) with the default label
 *    (direct: 확인 후 실행 / cli: 수동);
 *  - the dropdown offers the right options per engine (direct: ask+auto,
 *    cli: manual+auto+yolo) each with a desc line;
 *  - selecting an option persists to localStorage kimi.sessionPerm.<sid> and
 *    calls window.kimi.setSessionPermission(sid, mode) with the right args;
 *  - IPC failure reverts the optimistic write;
 *  - a "reload" (fresh vm over the same localStorage) restores the label.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(
  path.resolve(__dirname, '..', 'renderer', 'js', 'chat-options.js'),
  'utf8',
);

/* ---- minimal DOM stub -------------------------------------------------- */

function makeElement(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    children: [],
    parentNode: null,
    className: '',
    textContent: '',
    hidden: false,
    dataset: {},
    style: {},
    attributes: {},
    listeners: {},
    classList: {
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
    contains() { return false; },
    addEventListener(type, fn) { (el.listeners[type] ??= []).push(fn); },
    removeEventListener() {},
    setAttribute(name, value) { el.attributes[name] = String(value); },
    removeAttribute(name) { delete el.attributes[name]; },
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
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
  return el;
}

function makeWorld({ engine, sessionId = 'sid1', storageSeed = {}, kimi = {} } = {}) {
  const storage = new Map(Object.entries(storageSeed));
  const permPill = makeElement('button');
  permPill.id = 'permission-select';
  permPill.hidden = true; // matches index.html

  const body = makeElement('body');
  const doc = {
    body,
    _listeners: {},
    querySelector: (sel) => (sel === '#permission-select' ? permPill : null),
    createElement: (tag) => makeElement(tag),
    addEventListener(type, fn) { (doc._listeners[type] ??= []).push(fn); },
    removeEventListener() {},
  };

  const kimiCalls = [];
  const window = {
    App: { state: { engine, activeSessionId: sessionId, sessions: [] } },
    I18N: null, // exercise the Korean fallbacks
    innerWidth: 1280,
    innerHeight: 800,
    kimi: {
      setSessionPermission: async (sid, mode) => { kimiCalls.push([sid, mode]); },
      ...kimi,
    },
  };
  const localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  };
  const context = vm.createContext({
    window, document: doc, localStorage, console,
    setTimeout, clearTimeout, Promise,
  });
  vm.runInContext(SRC, context, { filename: 'chat-options.js' });
  return { window, doc, permPill, body, storage, kimiCalls };
}

const flush = () => new Promise((r) => setTimeout(r, 5));

function openDropdown(body) {
  // The open dropdown is the .model-dropdown element appended to body.
  return body.children.find((c) => c.className === 'model-dropdown') ?? null;
}

function dropdownOptions(dropdown) {
  return dropdown.children
    .filter((c) => c.className === 'model-dropdown-item')
    .map((item) => {
      const label = item.findAll((n) => n.className === 'model-dropdown-label')[0];
      const desc = item.findAll((n) => n.className === 'model-dropdown-desc')[0];
      return { item, label: label?.textContent, desc: desc?.textContent ?? null };
    });
}

/* ---- tests -------------------------------------------------------------- */

test('direct engine: visible, default label, ask+auto options with desc lines', async () => {
  const w = makeWorld({ engine: 'direct' });
  w.window.ChatOptions.init();
  assert.equal(w.permPill.hidden, false);
  assert.equal(w.permPill.textContent, '확인 후 실행');
  assert.match(w.permPill.title ?? '', /권한/);

  w.permPill.click();
  await flush();
  const dd = openDropdown(w.body);
  assert.ok(dd, 'dropdown opens');
  const opts = dropdownOptions(dd);
  assert.deepEqual(opts.map((o) => o.label), ['확인 후 실행', '자동 승인']);
  assert.ok(opts.every((o) => typeof o.desc === 'string' && o.desc.length > 0));
});

test('direct engine: selection persists + IPC args; failure reverts', async () => {
  const w = makeWorld({ engine: 'direct' });
  w.window.ChatOptions.init();
  w.permPill.click();
  await flush();
  dropdownOptions(w.body.children.find((c) => c.className === 'model-dropdown'))[1]
    .item.click(); // 자동 승인
  await flush();
  assert.equal(w.storage.get('kimi.sessionPerm.sid1'), 'auto');
  assert.deepEqual(w.kimiCalls, [['sid1', 'auto']]);
  assert.equal(w.permPill.textContent, '자동 승인');

  // Failure path: IPC rejects -> optimistic write reverts.
  const failing = makeWorld({
    engine: 'direct',
    storageSeed: { 'kimi.sessionPerm.sid1': 'ask' },
    kimi: {
      setSessionPermission: async () => { throw new Error('ipc down'); },
    },
  });
  failing.window.ChatOptions.init();
  assert.equal(failing.permPill.textContent, '확인 후 실행'); // seeded value read back
  failing.permPill.click();
  await flush();
  dropdownOptions(failing.body.children.find((c) => c.className === 'model-dropdown'))[1]
    .item.click();
  await flush();
  assert.equal(failing.storage.get('kimi.sessionPerm.sid1'), 'ask', 'reverted');
  assert.equal(failing.permPill.textContent, '확인 후 실행');
});

test('cli engine: manual+auto+yolo options, default 수동, YOLO selection', async () => {
  const w = makeWorld({ engine: 'cli' });
  w.window.ChatOptions.init();
  assert.equal(w.permPill.hidden, false);
  assert.equal(w.permPill.textContent, '수동');

  w.permPill.click();
  await flush();
  const opts = dropdownOptions(openDropdown(w.body));
  assert.deepEqual(opts.map((o) => o.label), ['수동', '자동 승인', 'YOLO']);
  assert.match(opts[2].desc ?? '', /승인 없이/);

  opts[2].item.click(); // YOLO
  await flush();
  assert.equal(w.storage.get('kimi.sessionPerm.sid1'), 'yolo');
  assert.deepEqual(w.kimiCalls, [['sid1', 'yolo']]);
  assert.equal(w.permPill.textContent, 'YOLO');
});

test('persistence across reload: stored mode restores the pill label', async () => {
  const w = makeWorld({
    engine: 'cli',
    storageSeed: { 'kimi.sessionPerm.sid1': 'auto' },
  });
  w.window.ChatOptions.init();
  assert.equal(w.permPill.textContent, '자동 승인');
  // Foreign-mode values for the active engine fall back to the default.
  const wrong = makeWorld({
    engine: 'direct',
    storageSeed: { 'kimi.sessionPerm.sid1': 'yolo' }, // not a direct mode
  });
  wrong.window.ChatOptions.init();
  assert.equal(wrong.permPill.textContent, '확인 후 실행');
});

test('hidden when the preload omits setSessionPermission', async () => {
  const w = makeWorld({ engine: 'direct' });
  delete w.window.kimi.setSessionPermission;
  w.window.ChatOptions.init();
  assert.equal(w.permPill.hidden, true);
});
