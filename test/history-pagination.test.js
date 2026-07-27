'use strict';

/**
 * history-pagination.test.js — paged conversation history (infinite scroll).
 * Proves the daemon page shape, the local-store paging behind
 * backend.getMessagesPage, and the renderer wiring that pulls older pages in.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const { KimiClient } = require('../main/kimi-client');

test('CLI getMessagesPage pages backwards with before_id and maps has_more', async () => {
  const client = new KimiClient({ baseUrl: 'http://127.0.0.1:1', token: 'test-token' });
  const calls = [];
  client.request = async (method, requestPath) => {
    calls.push({ method, requestPath });
    return {
      items: [{ id: 'm3' }, { id: 'm2' }], // wire is newest-first
      has_more: true,
    };
  };

  const page = await client.getMessagesPage('session_1', { beforeId: 'm4' });
  assert.deepEqual(calls, [{
    method: 'GET',
    requestPath: '/sessions/session_1/messages?before_id=m4&page_size=100',
  }]);
  assert.deepEqual(page.items.map((m) => m.id), ['m2', 'm3']); // chronological
  assert.equal(page.hasMore, true);

  const first = await client.getMessagesPage('session_1');
  assert.equal(calls[1].requestPath, '/sessions/session_1/messages?page_size=100');
  assert.equal(first.hasMore, true);
});

/* ---- backend.getMessagesPage over the local (direct-store) history -------- */

const BACKEND_PATH = path.resolve(__dirname, '..', 'main', 'backend.js');

function makeHarness(messageCount) {
  const messages = Array.from({ length: messageCount }, (_, i) => ({
    id: 'm' + String(i + 1).padStart(3, '0'),
    role: i % 2 ? 'assistant' : 'user',
    content: [{ type: 'text', text: 'msg ' + (i + 1) }],
    created_at: new Date(1700000000000 + i * 1000).toISOString(),
  }));
  const sessions = { sid1: { id: 'sid1', cwd: '/tmp/x', model: 'k3', effort: 'high' } };
  const store = {
    async get(id) { return sessions[id] ?? null; },
    async setConfig(id, patch) { if (sessions[id]) Object.assign(sessions[id], patch); },
    async list() { return Object.values(sessions); },
    async getMessages() { return messages; },
    async appendTurn() {},
    async usageByDay() { return []; },
  };
  const fakeStoreMod = { createStore: () => store };
  const fakeClient = { async runTurn() {} };

  const origLoad = Module._load;
  Module._load = function load(request, parent, ...rest) {
    if (parent && parent.filename === BACKEND_PATH) {
      if (request === './direct-store') return fakeStoreMod;
      if (request === './direct-client') return fakeClient;
    }
    return origLoad.call(this, request, parent, ...rest);
  };

  delete require.cache[BACKEND_PATH];
  const backend = require(BACKEND_PATH);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-history-backend-'));
  return {
    backend,
    async init() {
      await backend.init({ app: { getPath: () => userData }, send: () => {} });
    },
    cleanup() {
      Module._load = origLoad;
      fs.rmSync(userData, { recursive: true, force: true });
    },
  };
}

test('local history pages newest-first window with hasMore, then walks back', async () => {
  const h = makeHarness(250);
  await h.init();
  try {
    const newest = await h.backend.getMessagesPage('sid1');
    assert.equal(newest.items.length, 100);
    assert.equal(newest.items.at(-1).id, 'm250');
    assert.equal(newest.items[0].id, 'm151');
    assert.equal(newest.hasMore, true);

    const second = await h.backend.getMessagesPage('sid1', newest.items[0].id);
    assert.equal(second.items.length, 100);
    assert.equal(second.items[0].id, 'm051');
    assert.equal(second.hasMore, true);

    const last = await h.backend.getMessagesPage('sid1', second.items[0].id);
    assert.equal(last.items.length, 50);
    assert.equal(last.items[0].id, 'm001');
    assert.equal(last.hasMore, false);

    // No more pages once the oldest message is reached.
    const empty = await h.backend.getMessagesPage('sid1', 'm001');
    assert.equal(empty.items.length, 0);
    assert.equal(empty.hasMore, false);
  } finally {
    h.cleanup();
  }
});

test('short local history reports hasMore false on the first page', async () => {
  const h = makeHarness(3);
  await h.init();
  try {
    const page = await h.backend.getMessagesPage('sid1');
    assert.equal(page.items.length, 3);
    assert.equal(page.hasMore, false);
  } finally {
    h.cleanup();
  }
});

/* ---- renderer wiring -------------------------------------------------------- */

const read = (relativePath) => fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');

test('initial session load uses the paged API and passes hasMore through', () => {
  const app = read('renderer/js/app.js');
  assert.match(app, /window\.kimi\.getMessagesPage\(id\)/);
  assert.match(app, /renderMessages\?\.\(page\?\.items \?\? \[\], id, \{ hasMore: !!page\?\.hasMore \}\)/);
});

test('top-scroll loads older pages with a skeleton and keeps the viewport anchored', () => {
  const chat = read('renderer/js/chat.js');
  assert.match(chat, /scrollTop < 60\) void loadOlderHistory\(\)/);
  assert.match(chat, /function loadOlderHistory\(\)/);
  assert.match(chat, /window\.kimi\.getMessagesPage\(sid, oldest\)/);
  assert.match(chat, /setOlderSkeleton\(true\)/);
  assert.match(chat, /transcriptEl\.scrollTop = prevTop \+ \(transcriptEl\.scrollHeight - prevHeight\)/);
  assert.match(chat, /historyHasMore = !!page\?\.hasMore/);
});

test('older-history and task-list loading have skeleton chrome', () => {
  const layout = read('renderer/styles/layout.css');
  const panel = read('renderer/js/panel.js');
  const panelCss = read('renderer/styles/panel.css');

  assert.match(layout, /\.history-older-skeleton \{/);
  assert.match(layout, /\.history-older-line \{/);
  assert.match(panel, /panel-tasks-skeleton/);
  assert.match(panel, /st\.tasks == null && st\.busy && canListTasks\(\)/);
  assert.match(panelCss, /\.panel-tasks-skeleton-row \{/);
});
