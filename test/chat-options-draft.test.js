'use strict';

/**
 * chat-options-draft.test.js — DOM harness for the draft-chat (no session yet)
 * option picks in renderer/js/chat-options.js, plus the v7 swarm dropdown.
 * Same hand-rolled DOM stub pattern as permission-pill.test.js (no jsdom in
 * this repo): the real IIFE source runs inside a vm context.
 *
 * Proves:
 *  - with no active session, thinking-effort / permission / model / swarm
 *    picks write one-shot pending keys (kimi.pendingEffort / kimi.pendingPerm /
 *    kimi.pendingModel / kimi.pendingSwarm), update the pill, and fire NO IPC;
 *  - the draft swarm pill no longer mutates the global settings default and
 *    still seeds from it when no pending pick exists;
 *  - ChatOptions.applyPending(sid) applies the picks to a freshly created
 *    session (IPC + per-session keys), clears the pending keys, and drops
 *    engine-foreign/invalid values without IPC;
 *  - in-session, the swarm pill is an explicit ON/OFF dropdown that applies
 *    immediately and reverts on IPC failure (v7: was a flip toggle).
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
  // Real-DOM semantics: assigning textContent replaces all children.
  let text = '';
  Object.defineProperty(el, 'textContent', {
    get() { return text; },
    set(v) { text = String(v); el.children.length = 0; },
  });
  return el;
}

const PILL_IDS = ['model-select', 'swarm-toggle', 'effort-select', 'permission-select'];

function makeWorld({ engine, activeId = null, storageSeed = {}, kimi = {} } = {}) {
  const storage = new Map(Object.entries(storageSeed));
  const els = {};
  for (const id of PILL_IDS) {
    const el = makeElement('button');
    el.id = id;
    el.hidden = id !== 'model-select'; // matches index.html
    els[id] = el;
  }

  const body = makeElement('body');
  const doc = {
    body,
    _listeners: {},
    querySelector: (sel) => (sel.startsWith('#') ? els[sel.slice(1)] ?? null : null),
    createElement: (tag) => makeElement(tag),
    addEventListener(type, fn) { (doc._listeners[type] ??= []).push(fn); },
    removeEventListener() {},
  };

  const calls = {
    setSessionModel: [],
    setSessionSwarm: [],
    setSessionEffort: [],
    setSessionPermission: [],
  };
  const window = {
    App: {
      state: {
        engine,
        activeId,
        activeSessionId: activeId,
        sessions: [],
        defaultModel: 'k2',
      },
    },
    I18N: null, // exercise the Korean fallbacks
    innerWidth: 1280,
    innerHeight: 800,
    kimi: {
      listModels: async () => [{ alias: 'k2' }, { alias: 'k2-thinking' }],
      setSessionModel: async (sid, m) => { calls.setSessionModel.push([sid, m]); },
      setSessionSwarm: async (sid, on) => { calls.setSessionSwarm.push([sid, on]); },
      setSessionEffort: async (sid, e) => { calls.setSessionEffort.push([sid, e]); },
      setSessionPermission: async (sid, p) => { calls.setSessionPermission.push([sid, p]); },
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
  return { window, doc, els, body, storage, calls };
}

const flush = () => new Promise((r) => setTimeout(r, 5));

function openDropdown(body) {
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

function swarmState(btn) {
  return btn.findAll((n) => n.className === 'swarm-state')[0]?.textContent ?? null;
}

/* ---- draft chat (no active session) ------------------------------------- */

test('draft chat: thinking level + permission picks become one-shot pending values', async () => {
  const w = makeWorld({ engine: 'cli' });
  w.window.ChatOptions.init();
  const effort = w.els['effort-select'];
  const perm = w.els['permission-select'];
  assert.equal(effort.hidden, false);
  assert.equal(effort.textContent, '높음'); // default level
  assert.match(effort.title ?? '', /새 대화에 적용/);
  assert.equal(perm.textContent, '수동'); // cli default
  assert.match(perm.title ?? '', /새 대화에 적용/);

  effort.click();
  await flush();
  dropdownOptions(openDropdown(w.body))[3].item.click(); // 최대
  await flush();
  assert.equal(w.storage.get('kimi.pendingEffort'), 'max');
  assert.equal(effort.textContent, '최대');
  assert.deepEqual(w.calls.setSessionEffort, [], 'no IPC before the session exists');

  perm.click();
  await flush();
  dropdownOptions(openDropdown(w.body))[2].item.click(); // YOLO
  await flush();
  assert.equal(w.storage.get('kimi.pendingPerm'), 'yolo');
  assert.equal(perm.textContent, 'YOLO');
  assert.deepEqual(w.calls.setSessionPermission, [], 'no IPC before the session exists');
});

test('draft chat: swarm dropdown stores a pending pick, not the settings default', async () => {
  const w = makeWorld({ engine: 'cli' });
  w.window.ChatOptions.init();
  const btn = w.els['swarm-toggle'];
  assert.equal(btn.hidden, false);
  assert.equal(swarmState(btn), 'OFF');

  btn.click();
  await flush();
  const opts = dropdownOptions(openDropdown(w.body));
  assert.deepEqual(opts.map((o) => o.label), ['ON', 'OFF']);
  assert.ok(opts.every((o) => typeof o.desc === 'string' && o.desc.length > 0));
  opts[0].item.click(); // ON
  await flush();
  assert.equal(w.storage.get('kimi.pendingSwarm'), '1');
  assert.equal(w.storage.get('kimi.defaultSwarm'), undefined, 'global default untouched');
  assert.deepEqual(w.calls.setSessionSwarm, [], 'no IPC before the session exists');
  assert.equal(swarmState(btn), 'ON');
});

test('draft chat: swarm pill seeds from the settings default when no pending pick', () => {
  const w = makeWorld({ engine: 'cli', storageSeed: { 'kimi.defaultSwarm': '1' } });
  w.window.ChatOptions.init();
  assert.equal(swarmState(w.els['swarm-toggle']), 'ON');
});

test('draft chat: model pick stores a pending alias for the first session', async () => {
  const w = makeWorld({ engine: 'cli' });
  w.window.ChatOptions.init();
  const pill = w.els['model-select'];
  assert.equal(pill.textContent, 'k2'); // server default shown in draft
  assert.equal(pill.title, '모델 선택 — 새 대화에 적용');

  pill.click();
  await flush();
  await flush(); // listModels resolves asynchronously
  const opts = dropdownOptions(openDropdown(w.body));
  assert.deepEqual(opts.map((o) => o.label), ['k2', 'k2-thinking']);
  opts[1].item.click();
  await flush();
  assert.equal(w.storage.get('kimi.pendingModel'), 'k2-thinking');
  assert.equal(pill.textContent, 'k2-thinking');
  assert.deepEqual(w.calls.setSessionModel, [], 'no IPC before the session exists');
});

/* ---- applyPending: draft picks meet the freshly created session --------- */

test('applyPending applies draft picks to the new session, then clears them', async () => {
  const w = makeWorld({
    engine: 'cli',
    storageSeed: {
      'kimi.pendingModel': 'k2-thinking',
      'kimi.pendingSwarm': '1',
      'kimi.pendingEffort': 'max',
      'kimi.pendingPerm': 'yolo',
    },
  });
  w.window.ChatOptions.init();
  await w.window.ChatOptions.applyPending('sid9');

  assert.deepEqual(w.calls.setSessionModel, [['sid9', 'k2-thinking']]);
  assert.deepEqual(w.calls.setSessionSwarm, [['sid9', true]]);
  assert.deepEqual(w.calls.setSessionEffort, [['sid9', 'max']]);
  assert.deepEqual(w.calls.setSessionPermission, [['sid9', 'yolo']]);
  // Backend success also writes the per-session keys refresh() reads.
  assert.equal(w.storage.get('kimi.sessionModel.sid9'), 'k2-thinking');
  assert.equal(w.storage.get('kimi.sessionSwarm.sid9'), '1');
  assert.equal(w.storage.get('kimi.sessionEffort.sid9'), 'max');
  assert.equal(w.storage.get('kimi.sessionPerm.sid9'), 'yolo');
  // Pending values are one-shot.
  for (const k of ['kimi.pendingModel', 'kimi.pendingSwarm', 'kimi.pendingEffort', 'kimi.pendingPerm']) {
    assert.equal(w.storage.get(k), undefined, k);
  }
  // The session the app just switched to shows the applied values.
  w.window.ChatOptions.refresh('sid9');
  assert.equal(w.els['model-select'].textContent, 'k2-thinking');
  assert.equal(w.els['effort-select'].textContent, '최대');
  assert.equal(w.els['permission-select'].textContent, 'YOLO');
  assert.equal(swarmState(w.els['swarm-toggle']), 'ON');
});

test('applyPending drops engine-foreign or invalid pending values without IPC', async () => {
  const w = makeWorld({
    engine: 'direct', // preload omits setSessionSwarm under direct
    kimi: { setSessionSwarm: undefined },
    storageSeed: {
      'kimi.pendingSwarm': '1',
      'kimi.pendingEffort': 'bogus',
      'kimi.pendingPerm': 'yolo', // cli-only mode, invalid under direct
    },
  });
  w.window.ChatOptions.init();
  await w.window.ChatOptions.applyPending('sid9');

  assert.deepEqual(w.calls.setSessionSwarm, []);
  assert.deepEqual(w.calls.setSessionEffort, []);
  assert.deepEqual(w.calls.setSessionPermission, []);
  assert.equal(w.storage.get('kimi.pendingSwarm'), undefined);
  assert.equal(w.storage.get('kimi.pendingEffort'), undefined);
  assert.equal(w.storage.get('kimi.pendingPerm'), undefined);
});

/* ---- in-session swarm dropdown (v7: was a flip toggle) ------------------- */

test('in-session: swarm dropdown applies immediately and reverts on failure', async () => {
  const w = makeWorld({
    engine: 'cli',
    activeId: 'sid1',
    storageSeed: { 'kimi.sessionSwarm.sid1': '0' },
  });
  w.window.ChatOptions.init();
  const btn = w.els['swarm-toggle'];
  assert.equal(swarmState(btn), 'OFF');

  btn.click();
  await flush();
  dropdownOptions(openDropdown(w.body))[0].item.click(); // ON
  await flush();
  assert.deepEqual(w.calls.setSessionSwarm, [['sid1', true]]);
  assert.equal(w.storage.get('kimi.sessionSwarm.sid1'), '1');
  assert.equal(swarmState(btn), 'ON');

  // Failure path: IPC rejects -> optimistic write reverts.
  const failing = makeWorld({
    engine: 'cli',
    activeId: 'sid1',
    storageSeed: { 'kimi.sessionSwarm.sid1': '0' },
    kimi: { setSessionSwarm: async () => { throw new Error('ipc down'); } },
  });
  failing.window.ChatOptions.init();
  failing.els['swarm-toggle'].click();
  await flush();
  dropdownOptions(openDropdown(failing.body))[0].item.click(); // ON
  await flush();
  assert.equal(failing.storage.get('kimi.sessionSwarm.sid1'), '0', 'reverted');
  assert.equal(swarmState(failing.els['swarm-toggle']), 'OFF');
});

test('direct engine: swarm pill stays inert (no dropdown)', async () => {
  const w = makeWorld({ engine: 'direct', kimi: { setSessionSwarm: undefined } });
  w.window.ChatOptions.init();
  const btn = w.els['swarm-toggle'];
  assert.equal(btn.classList.contains('disabled'), true);
  btn.click();
  await flush();
  assert.equal(openDropdown(w.body), null);
});
