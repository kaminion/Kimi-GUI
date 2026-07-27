'use strict';

/**
 * usage-session.test.js — current-session usage updates (renderer/js/usage.js).
 * DOM-stub vm harness in the changes-popover.test.js pattern. Proves:
 *  - render() shows a structured skeleton while the profile fetch is in flight;
 *  - the first real paint carries the one-time enter animation;
 *  - a per-call 'usage' push does NOT blank the cumulative rows (cost/turns),
 *    refreshes the context block in place, and arms a debounced profile refetch.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.resolve(__dirname, '..', 'renderer', 'js', 'usage.js'), 'utf8');

/* ---- minimal DOM stub ---------------------------------------------------- */

function classListOf(node) {
  return node.className.split(/\s+/).filter(Boolean);
}

function matchesSimple(node, selector) {
  // '.a.b' or 'tag' — enough for the usage view's queries.
  if (selector.startsWith('.')) {
    const want = selector.slice(1).split('.');
    const have = classListOf(node);
    return want.every((c) => have.includes(c));
  }
  return node.tagName === selector.toUpperCase();
}

function queryOne(node, selector) {
  // Support '.a .b' (descendant) and '.a > :first-child'.
  const descendantParts = selector.split(/\s+/);
  const last = descendantParts[descendantParts.length - 1];
  const firstChild = last.endsWith(':first-child');
  const simple = firstChild ? last.replace(/ > :first-child$|:first-child$/, '') : last;
  let found = null;
  const walk = (n) => {
    if (found) return;
    if (matchesSimple(n, simple)) {
      found = n;
      return;
    }
    for (const k of n.children) walk(k);
  };
  walk(node);
  if (found && firstChild) return found.children[0] ?? null;
  return found;
}

function makeElement(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    children: [],
    parentNode: null,
    className: '',
    classList: {
      _set: new Set(),
      _inited: false,
      _init() {
        if (this._inited) return;
        this._set = new Set(el.className.split(/\s+/).filter(Boolean));
        this._inited = true;
      },
      _sync() { el.className = [...this._set].join(' '); },
      add(...cs) { this._init(); cs.forEach((c) => this._set.add(c)); this._sync(); },
      remove(...cs) { this._init(); cs.forEach((c) => this._set.delete(c)); this._sync(); },
      toggle(c, force) {
        this._init();
        const on = force === undefined ? !this._set.has(c) : !!force;
        on ? this._set.add(c) : this._set.delete(c);
        this._sync();
        return on;
      },
      contains(c) { this._init(); return this._set.has(c); },
    },
    hidden: false,
    style: {},
    attributes: {},
    title: '',
    id: '',
    append(...kids) { for (const k of kids) el.appendChild(k); },
    appendChild(k) { k.parentNode = el; el.children.push(k); return k; },
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
    setAttribute(name, value) { el.attributes[name] = String(value); },
    addEventListener() {},
    querySelector(selector) { return queryOne(el, selector); },
    findAll(pred) {
      const out = [];
      const walk = (n) => {
        if (pred(n)) out.push(n);
        for (const k of n.children) walk(k);
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
  let ownText = '';
  Object.defineProperty(el, 'textContent', {
    get() { return ownText; },
    set(v) { ownText = String(v ?? ''); el.children = []; },
  });
  return el;
}

function makeWorld() {
  const byId = {
    'usage-view': makeElement('section'),
    'quota-cards': makeElement('div'),
    'session-usage': makeElement('div'),
  };
  const doc = {
    getElementById: (id) => byId[id] ?? null,
    createElement: (tag) => makeElement(tag),
  };
  const world = {
    window: {},
    document: doc,
    console,
    setTimeout,
    clearTimeout,
    Intl,
    Promise,
  };
  const profileCalls = [];
  let nextProfile = null;
  world.window.kimi = {
    getQuota: async () => null,
    getProfile: async (id) => {
      profileCalls.push(id);
      return nextProfile;
    },
  };
  const context = vm.createContext(world);
  vm.runInContext(SRC, context, { filename: 'usage.js' });
  return { window: world.window, byId, profileCalls, setProfile(p) { nextProfile = p; } };
}

const FULL = {
  input_tokens: 1000,
  output_tokens: 500,
  cache_read_tokens: 200,
  cache_creation_tokens: 100,
  total_cost_usd: 1.23,
  turn_count: 4,
  context_tokens: 50000,
  context_limit: 200000,
};

const PUSH = {
  input_tokens: 10,
  output_tokens: 5,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  context_tokens: 80000,
  context_limit: 200000,
};

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

test('render shows a skeleton, then paints the profile with an enter animation', async () => {
  const w = makeWorld();
  let resolveProfile;
  w.window.kimi.getProfile = (id) => {
    w.profileCalls.push(id);
    return new Promise((r) => { resolveProfile = r; });
  };

  const pending = w.window.Usage.render({ activeId: 's1', view: 'usage' });
  await tick();
  const box = w.byId['session-usage'];
  assert.ok(box.querySelector('.usage-skeleton'), 'skeleton while the profile is in flight');

  resolveProfile({ usage: FULL });
  await pending;
  const detail = box.querySelector('.usage-detail');
  assert.ok(detail, 'detail painted');
  assert.equal(box.querySelector('.usage-skeleton'), null, 'skeleton gone');
  assert.ok(detail.className.includes('usage-detail-enter'), 'one-time enter animation');
  assert.match(detail.text(), /\$1\.23/);
});

test('a per-call push keeps the totals, refreshes context, and refetches the profile', async () => {
  const w = makeWorld();
  w.setProfile({ usage: FULL });
  await w.window.Usage.render({ activeId: 's1', view: 'usage' });
  const box = w.byId['session-usage'];

  w.window.Usage.updateUsage('s1', PUSH);
  const detail = box.querySelector('.usage-detail');
  assert.ok(detail, 'detail still present after the push');
  assert.match(detail.text(), /\$1\.23/, 'cost row not blanked by the partial payload');
  assert.match(detail.text(), /80,000 \/ 200,000/, 'context value refreshed in place');
  assert.match(detail.text(), /40%/, 'context percent refreshed');
  assert.equal(detail, box.querySelector('.usage-detail'), 'push updates in place (no swap)');

  // The debounced refetch repaints the cumulative rows (still the FULL stub);
  // the swapped-in node carries no fresh enter animation.
  await tick(1700);
  assert.equal(w.profileCalls.length, 2, 'push armed exactly one profile refetch');
  const repainted = box.querySelector('.usage-detail');
  assert.match(repainted.text(), /\$1\.23/);
  assert.ok(repainted !== detail, 'refetch swaps the detail node');
  assert.equal(repainted.className.includes('usage-detail-enter'), false, 'refetch paints silently');
});

test('pushes for another session are ignored', async () => {
  const w = makeWorld();
  w.setProfile({ usage: FULL });
  await w.window.Usage.render({ activeId: 's1', view: 'usage' });
  w.window.Usage.updateUsage('other-session', PUSH);
  await tick(1700);
  assert.equal(w.profileCalls.length, 1, 'no refetch for a foreign session');
});
