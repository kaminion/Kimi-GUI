'use strict';

/**
 * steer-vanish.test.js — replay the daemon's steer (run-now) sequence against
 * chat.js and find where the scheduled message's UI goes. Harness pattern
 * matches live-turn-display.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.resolve(__dirname, '..', 'renderer', 'js', 'chat.js'), 'utf8');

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

function makeWorld({ runScheduledResult } = {}) {
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
    App: {
      state: { activeId: 's1', sessions: [{ id: 's1', cwd: '/repo' }] },
      runScheduled: async () => runScheduledResult,
      updateScheduled: async () => null,
      cancelScheduled: async () => false,
      scheduleMessage: async () => ({ prompt_id: 'p1', status: 'queued' }),
    },
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

function userRowTexts(transcript) {
  return transcript
    .querySelectorAll('.msg-user-text')
    .map((n) => n.text());
}

test('a sent card whose daemon copy has not landed yet survives the resync', async () => {
  const w = makeWorld({ runScheduledResult: { status: 'steering', prompt_id: 'p1' } });
  const Chat = w.window.Chat;
  const transcript = w.byId.transcript;
  Chat.init();
  Chat.setActiveSession('s1');

  Chat.applyEvent('s1', { type: 'turn.started', turnId: 0 });
  Chat.applyEvent('s1', { type: 'scheduled.updated', items: [{ prompt_id: 'p1', text: '11부터 세 줘' }] });
  const card = transcript.querySelector('.msg-steer');
  const runBtn = card.findAll((n) => n.className === 'msg-steer-action' && n.text() === '바로 실행')[0];
  runBtn.disabled = false;
  runBtn.click();
  await new Promise((r) => setTimeout(r, 10));
  Chat.applyEvent('s1', { type: 'prompt.steered', activePromptId: 'p0', promptIds: ['p1'] });

  // The turn ends and the resync runs BEFORE the daemon persisted the steered
  // copy (write lag): history has no '11부터 세 줘' yet.
  Chat.applyEvent('s1', { type: 'turn.ended', turnId: 0, reason: 'completed' });
  Chat.applyEvent('s1', { type: 'session.history_compacted' });
  await new Promise((r) => setTimeout(r, 500));

  assert.ok(transcript.text().includes('11부터 세 줘'),
    'sent card stays visible while the daemon copy is pending');

  // The copy arrives later: the card settles into a normal user row.
  w.window.kimi.getMessagesPage = async () => ({
    items: [
      { id: 'm2', role: 'user', prompt_id: 'p1', content: [{ type: 'text', text: '11부터 세 줘' }], created_at: '2026-01-01T00:01:00Z' },
    ],
    hasMore: false,
  });
  Chat.applyEvent('s1', { type: 'session.history_compacted' });
  await new Promise((r) => setTimeout(r, 500));
  const rows = transcript.querySelectorAll('.msg-user-text').map((n) => n.text());
  assert.ok(rows.some((t) => t.includes('11부터 세 줘')), 'message renders as a normal row once persisted');
  assert.equal(transcript.querySelector('.msg-steer'), null, 'card settled away');
});

test('run-now (steer) keeps the scheduled message visible through the turn', async () => {
  const w = makeWorld({ runScheduledResult: { status: 'steering', prompt_id: 'p1' } });
  const Chat = w.window.Chat;
  const transcript = w.byId.transcript;
  Chat.init();
  Chat.setActiveSession('s1');

  // Busy turn + scheduled card adopted from the queue.
  Chat.applyEvent('s1', { type: 'turn.started', turnId: 0 });
  Chat.applyEvent('s1', { type: 'scheduled.updated', items: [{ prompt_id: 'p1', text: '11부터 세 줘' }] });
  const card = transcript.querySelector('.msg-steer');
  assert.ok(card, 'scheduled card visible before steer');

  // User clicks run-now: the card's run button fires app.runScheduled.
  const runBtn = card.findAll((n) => n.className === 'msg-steer-action' && n.text() === '바로 실행')[0];
  assert.ok(runBtn, 'run button present');
  runBtn.disabled = false;
  runBtn.click();
  await new Promise((r) => setTimeout(r, 10));

  // Daemon follows with prompt.steered, the queue update, and the turn end.
  Chat.applyEvent('s1', { type: 'prompt.steered', activePromptId: 'p0', promptIds: ['p1'] });
  Chat.applyEvent('s1', { type: 'scheduled.updated', items: [], departed: [{ prompt_id: 'p1', reason: 'steered' }] });
  Chat.applyEvent('s1', { type: 'turn.ended', turnId: 0, reason: 'completed' });
  await new Promise((r) => setTimeout(r, 10));

  // The steered message lands in history via the resync (daemon persists its copy).
  w.window.kimi.getMessagesPage = async () => ({
    items: [
      { id: 'm1', role: 'user', content: [{ type: 'text', text: '첫 질문' }], created_at: '2026-01-01T00:00:00Z' },
      { id: 'm2', role: 'user', prompt_id: 'p1', content: [{ type: 'text', text: '11부터 세 줘' }], created_at: '2026-01-01T00:01:00Z' },
      { id: 'm3', role: 'assistant', content: [{ type: 'text', text: '11, 12, 13.' }], created_at: '2026-01-01T00:02:00Z' },
    ],
    hasMore: false,
  });
  Chat.applyEvent('s1', { type: 'session.history_compacted' }); // forces scheduleReload
  await new Promise((r) => setTimeout(r, 400));

  const texts = userRowTexts(transcript);
  assert.ok(texts.some((t) => t.includes('11부터 세 줘')), 'steered message visible after resync, got: ' + JSON.stringify(texts));
  assert.ok(transcript.text().includes('11, 12, 13.'), 'assistant answer visible');
});
