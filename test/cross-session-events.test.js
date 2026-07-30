'use strict';

/**
 * cross-session-events.test.js — background sessions must never bleed into
 * the viewed session: the applyEvent filter, plus the switch-window guards
 * (early retarget + in-flight resync drop).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (relativePath) => fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
const SRC = read('renderer/js/chat.js');

/* ---- source-level guards -------------------------------------------------- */

test('selectSession retargets chat.js before the paged load begins', () => {
  const app = read('renderer/js/app.js');
  assert.match(
    app,
    /App\.state\.activeId = id;\s*\/\/ Point chat\.js at the new session immediately[\s\S]*?window\.Chat\?\.setActiveSession\?\.\(id\);\s*App\.showView\('chat'\)/,
  );
});

test('an in-flight resync is dropped when the session changed mid-flight', () => {
  assert.match(SRC, /const reloadSessionId = activeSessionId;/);
  assert.match(SRC, /if \(reloadSessionId !== activeSessionId\) return;/);
  assert.match(SRC, /window\.kimi\.getMessagesPage\(reloadSessionId\)/);
});

/* ---- behavior: the applyEvent filter (harness from steer-vanish) ---------- */

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
    get childNodes() { return el.children; },
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
    focus() {},
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
    Markdown2: null,
    kimi: {
      getMessagesPage: async () => ({ items: [], hasMore: false }),
      getMessages: async () => [],
    },
    CustomEvent: null,
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

test('background session events render nothing while viewing another session', () => {
  const w = makeWorld();
  const Chat = w.window.Chat;
  const transcript = w.byId.transcript;
  Chat.init();
  Chat.setActiveSession('s1');

  Chat.applyEvent('s2', { type: 'turn.started', turnId: 0 });
  Chat.applyEvent('s2', { type: 'thinking.delta', turnId: 0, delta: 'session 2 thinking' });
  Chat.applyEvent('s2', { type: 'assistant.delta', turnId: 0, delta: 'session 2 answer' });
  Chat.applyEvent('s2', { type: 'turn.ended', turnId: 0, reason: 'completed' });

  assert.equal(transcript.querySelector('.msg-live'), null, 'no live row from session 2');
  assert.ok(!transcript.text().includes('session 2'), 'no session-2 content rendered');
});

test('a resync scheduled before the switch does not overwrite the new session', async () => {
  const w = makeWorld();
  const Chat = w.window.Chat;
  const transcript = w.byId.transcript;
  Chat.init();
  Chat.setActiveSession('s1');

  // s1 turn ends: a resync is scheduled (debounced).
  Chat.applyEvent('s1', { type: 'turn.started', turnId: 0 });
  Chat.applyEvent('s1', { type: 'turn.ended', turnId: 0, reason: 'completed' });

  // …and s1's history would arrive after the user already moved to s2.
  w.window.kimi.getMessagesPage = async () => ({
    items: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'session 1 content' }], created_at: '2026-01-01T00:00:00Z' }],
    hasMore: false,
  });
  Chat.setActiveSession('s2');
  await new Promise((r) => setTimeout(r, 500));

  assert.ok(!transcript.text().includes('session 1 content'),
    'stale resync dropped: session 1 content never lands in the session 2 view');
});
