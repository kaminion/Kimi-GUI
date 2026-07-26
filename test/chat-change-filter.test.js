'use strict';

/**
 * chat-change-filter.test.js — DOM harness for the renderer half of
 * requirement (A) in renderer/js/chat.js: files that are clean in Git
 * (committed, possibly pushed) drop out of the conversation change snapshot.
 *
 * Same hand-rolled DOM stub pattern as permission-pill.test.js (no jsdom in
 * this repo): the real chat.js IIFE runs inside a vm context with a stub
 * window.kimi.getGitCleanFiles standing in for the main-process git call.
 *
 * Proves:
 *  - a fresh snapshot is published unfiltered (fail-open while git is unknown);
 *  - after the debounced refresh, clean paths are removed and fileCount /
 *    additions / deletions are recomputed from the remaining files;
 *  - a live mutation on a clean-cached file reinstates it immediately (the
 *    file is dirty by definition once the agent re-edits it);
 *  - failures and non-repository cwds keep every file (fail-open).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(
  path.resolve(__dirname, '..', 'renderer', 'js', 'chat.js'),
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
    value: '',
    hidden: false,
    disabled: false,
    open: false,
    dataset: {},
    style: {},
    attributes: {},
    listeners: {},
    scrollTop: 0,
    scrollHeight: 0,
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
    replaceWith(node) {
      if (!el.parentNode) return;
      const i = el.parentNode.children.indexOf(el);
      if (i >= 0) el.parentNode.children.splice(i, 1, node);
      node.parentNode = el.parentNode;
      el.parentNode = null;
    },
    contains() { return false; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener(type, fn) { (el.listeners[type] ??= []).push(fn); },
    removeEventListener() {},
    setAttribute(name, value) { el.attributes[name] = String(value); },
    removeAttribute(name) { delete el.attributes[name]; },
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    },
    focus() {},
    setSelectionRange() {},
    scrollIntoView() {},
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return ''; },
    set(v) { if (v === '') el.children = []; },
  });
  Object.defineProperty(el, 'childNodes', {
    get() { return el.children; },
  });
  return el;
}

function makeWorld({ clean = [], cleanError = null } = {}) {
  const byId = {
    transcript: makeElement('div'),
    composer: makeElement('textarea'),
    'send-btn': makeElement('button'),
  };
  const doc = {
    readyState: 'complete',
    getElementById: (id) => byId[id] ?? null,
    createElement: (tag) => makeElement(tag),
    addEventListener() {},
    removeEventListener() {},
  };

  const events = [];
  const gitCalls = [];
  const window = {
    App: { state: { sessions: [{ id: 'sid1', cwd: '/repo' }], activeId: 'sid1' } },
    I18N: null,
    kimi: {
      getGitCleanFiles: async (cwd, paths) => {
        gitCalls.push([cwd, paths]);
        if (cleanError) throw cleanError;
        return clean; // { isRepository, clean: [...] }
      },
    },
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init?.detail; }
    },
    addEventListener(type, fn) { (window._listeners[type] ??= []).push(fn); },
    removeEventListener() {},
    dispatchEvent(event) { events.push(event); return true; },
    _listeners: {},
  };
  const localStorage = {
    _map: new Map(),
    getItem(k) { return this._map.has(k) ? this._map.get(k) : null; },
    setItem(k, v) { this._map.set(k, String(v)); },
    removeItem(k) { this._map.delete(k); },
  };
  const context = vm.createContext({
    window, document: doc, localStorage, console,
    CustomEvent: window.CustomEvent,
    setTimeout, clearTimeout, setInterval, clearInterval, Promise,
  });
  vm.runInContext(SRC, context, { filename: 'chat.js' });
  return { window, events, gitCalls };
}

function editMessage(id, edits) {
  return {
    id,
    role: 'assistant',
    created_at: id,
    content: edits.map(([file, n]) => ({
      type: 'tool_use',
      tool_call_id: `call-${id}-${n}`,
      tool_name: 'Edit',
      input: { file_path: file, old_string: 'old line\n', new_string: 'new line\n' },
    })),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- tests -------------------------------------------------------------- */

test('clean files drop out after the refresh; totals recompute from the rest', async () => {
  const w = makeWorld({
    clean: { isRepository: true, clean: ['/repo/committed.js'] },
  });
  w.window.Chat.setActiveSession('sid1');
  w.window.Chat.renderMessages([
    editMessage('m1', [['/repo/committed.js', 1], ['/repo/dirty.js', 2]]),
  ], 'sid1');

  // Fail-open before the git answer lands: both files are shown.
  let summary = w.window.Chat.getChangeSummary();
  assert.equal(summary.fileCount, 2);
  assert.equal(summary.additions, 2);
  assert.equal(summary.deletions, 2);

  await sleep(450); // past the 300ms debounce + IPC

  // vm-realm arrays fail deepStrictEqual on prototypes — compare via JSON.
  assert.equal(JSON.stringify(w.gitCalls), JSON.stringify([['/repo', ['/repo/committed.js', '/repo/dirty.js']]]));
  summary = w.window.Chat.getChangeSummary();
  assert.equal(summary.fileCount, 1);
  assert.equal(JSON.stringify(Array.from(summary.files, (f) => f.path)), JSON.stringify(['/repo/dirty.js']));
  assert.equal(summary.additions, 1);
  assert.equal(summary.deletions, 1);

  // The emitted event carries the filtered snapshot too.
  const last = w.events.filter((e) => e.type === 'kimi:changes-updated').at(-1);
  assert.equal(last.detail.fileCount, 1);
});

test('a live re-edit of a clean-cached file reinstates it immediately', async () => {
  const w = makeWorld({
    clean: { isRepository: true, clean: ['/repo/committed.js'] },
  });
  w.window.Chat.setActiveSession('sid1');
  w.window.Chat.renderMessages([editMessage('m1', [['/repo/committed.js', 1]])], 'sid1');
  await sleep(450);
  assert.equal(w.window.Chat.getChangeSummary().fileCount, 0, 'committed away');

  // The agent edits the same file again: dirty by definition, no wait for git.
  w.window.Chat.applyEvent('sid1', {
    type: 'tool.call.started',
    payload: {
      turnId: 't1',
      toolCallId: 'c1',
      name: 'Edit',
      args: { file_path: '/repo/committed.js', old_string: 'a\n', new_string: 'b\n' },
    },
  });
  const summary = w.window.Chat.getChangeSummary();
  assert.equal(summary.fileCount, 1);
  assert.equal(JSON.stringify(Array.from(summary.files, (f) => f.path)), JSON.stringify(['/repo/committed.js']));
});

test('fail-open: IPC failure and non-repository cwd keep every file', async () => {
  const failing = makeWorld({ cleanError: new Error('ipc down') });
  failing.window.Chat.setActiveSession('sid1');
  failing.window.Chat.renderMessages([editMessage('m1', [['/repo/a.js', 1]])], 'sid1');
  await sleep(450);
  assert.equal(failing.window.Chat.getChangeSummary().fileCount, 1);

  const notRepo = makeWorld({ clean: { isRepository: false, clean: [] } });
  notRepo.window.Chat.setActiveSession('sid1');
  notRepo.window.Chat.renderMessages([editMessage('m1', [['/repo/a.js', 1]])], 'sid1');
  await sleep(450);
  assert.equal(notRepo.window.Chat.getChangeSummary().fileCount, 1);
});
