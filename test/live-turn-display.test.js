'use strict';

/**
 * live-turn-display.test.js — the live process block must appear as soon as a
 * turn starts (no session round-trip). chat.js runs in a vm DOM stub; the
 * turn.started → thinking.delta → turn.ended sequence is replayed from the
 * wire vocabulary of main/backend.js (direct engine) and the daemon.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.resolve(__dirname, '..', 'renderer', 'js', 'chat.js'), 'utf8');

/* ---- DOM stub ------------------------------------------------------------ */

function matchesSimple(node, selector) {
  if (!selector.startsWith('.')) return node.tagName === selector.toUpperCase();
  const want = selector.slice(1).split('.');
  const have = node.className.split(/\s+/).filter(Boolean);
  return want.every((c) => have.includes(c));
}

function makeElement(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    children: [],
    parentNode: null,
    className: '',
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
    dataset: {},
    style: {},
    attributes: {},
    listeners: {},
    hidden: false,
    disabled: false,
    open: false,
    value: '',
    title: '',
    rows: 1,
    scrollTop: 0,
    scrollHeight: 1000,
    clientHeight: 500,
    append(...kids) { for (const k of kids) el.appendChild(k); },
    appendChild(k) { k.parentNode = el; el.children.push(k); return k; },
    prepend(k) { k.parentNode = el; el.children.unshift(k); return k; },
    insertBefore(k, ref) {
      k.parentNode = el;
      const i = ref ? el.children.indexOf(ref) : -1;
      if (i >= 0) el.children.splice(i, 0, k);
      else el.children.push(k);
      return k;
    },
    remove() {
      if (el.parentNode) {
        const i = el.parentNode.children.indexOf(el);
        if (i >= 0) el.parentNode.children.splice(i, 1);
        el.parentNode = null;
      }
    },
    replaceWith(k) {
      if (!el.parentNode) return;
      const i = el.parentNode.children.indexOf(el);
      if (i >= 0) {
        k.parentNode = el.parentNode;
        el.parentNode.children[i] = k;
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
    closest(selector) {
      let cur = el;
      while (cur) {
        if (matchesSimple(cur, selector)) return cur;
        cur = cur.parentNode;
      }
      return null;
    },
    addEventListener(type, fn) { (el.listeners[type] ??= []).push(fn); },
    removeEventListener() {},
    setAttribute(name, value) { el.attributes[name] = String(value); },
    removeAttribute(name) { delete el.attributes[name]; },
    querySelector(selector) {
      let found = null;
      const walk = (n) => {
        if (found) return;
        if (matchesSimple(n, selector)) { found = n; return; }
        for (const k of n.children) walk(k);
      };
      walk(el);
      return found;
    },
    querySelectorAll(selector) {
      const out = [];
      const walk = (n) => {
        if (matchesSimple(n, selector)) out.push(n);
        for (const k of n.children) walk(k);
      };
      walk(el);
      return out;
    },
    findAll(pred) {
      const out = [];
      const walk = (n) => {
        if (pred(n)) out.push(n);
        for (const k of n.children) walk(k);
      };
      walk(el);
      return out;
    },
    focus() {},
    click() { for (const fn of el.listeners.click ?? []) fn({ target: el }); },
    text() {
      let s = el.textContent ?? '';
      for (const k of el.children) s += k.text();
      return s;
    },
  };
  let ownText = '';
  Object.defineProperty(el, 'textContent', {
    get() { return ownText; },
    set(v) { ownText = String(v ?? ''); el.children = []; },
  });
  Object.defineProperty(el, 'innerHTML', {
    get() { return ownText; },
    set(v) { ownText = String(v ?? ''); el.children = []; },
  });
  return el;
}

function makeWorld() {
  const byId = {
    transcript: makeElement('div'),
    composer: makeElement('textarea'),
    'send-btn': makeElement('button'),
  };
  const doc = {
    body: makeElement('body'),
    getElementById: (id) => byId[id] ?? null,
    createElement: (tag) => makeElement(tag),
    addEventListener() {},
  };
  const window = {
    App: { state: { activeId: 's1', sessions: [{ id: 's1', cwd: '/repo' }] } },
    I18N: null,
    Markdown2: null, // esc fallback path
    kimi: {
      getMessagesPage: async () => ({ items: [], hasMore: false }),
      getMessages: async () => [],
    },
    CustomEvent: null, // emitChangeSnapshot skips dispatch
    dispatchEvent() {},
    addEventListener() {},
  };
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const context = vm.createContext({
    window, document: doc, localStorage, console,
    setTimeout, clearTimeout, Promise,
    requestAnimationFrame: (fn) => fn(),
  });
  vm.runInContext(SRC, context, { filename: 'chat.js' });
  return { window, byId };
}

/* ---- tests --------------------------------------------------------------- */

test('turn.started opens a live process row immediately; deltas stream into it', async () => {
  const w = makeWorld();
  const Chat = w.window.Chat;
  Chat.init();
  Chat.setActiveSession('s1');

  Chat.applyEvent('s1', { type: 'turn.started', turn_id: 't1' });
  const transcript = w.byId.transcript;
  const live = transcript.querySelector('.msg-live');
  assert.ok(live, 'live row exists right after turn.started');
  assert.ok(live.querySelector('.msg-process'), 'process block present');
  assert.equal(live.querySelector('.msg-process').open, false, 'block starts collapsed (header carries the activity)');

  Chat.applyEvent('s1', { type: 'thinking.delta', turn_id: 't1', delta: '구조를 분석하는 중…' });
  const thinking = live.querySelector('.msg-process-thinking');
  assert.ok(thinking, 'thinking prose still streams into the block while collapsed');

  Chat.applyEvent('s1', { type: 'assistant.delta', turn_id: 't1', delta: '답변 초안' });
  assert.ok(live.querySelector('.msg-assistant'), 'answer area present');

  Chat.applyEvent('s1', { type: 'turn.ended', turn_id: 't1', reason: 'completed' });
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(true, 'settle path ran without errors');
});

test('unknown session id does not block events while no session is active', () => {
  const w = makeWorld();
  const Chat = w.window.Chat;
  Chat.init();
  // Draft: no active session — events for the lazily-created id must pass.
  Chat.applyEvent('new-id', { type: 'turn.started', turn_id: 't9' });
  assert.ok(w.byId.transcript.querySelector('.msg-live'), 'live row appears in a fresh draft');
});
