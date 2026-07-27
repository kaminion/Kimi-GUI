'use strict';

/**
 * abort-scheduled.test.js — stop hands the session to the scheduled queue
 * (direct engine). Same Module._load stub pattern as permission-backend.test.js.
 *
 * Proves:
 *  1. abort() interrupts the active turn and, when a scheduled message waits,
 *     auto-runs it as its own turn (reason 'started' on scheduled.updated);
 *  2. the hand-off waits for the interrupted turn to unwind, so the new turn
 *     never collides with the old one in activeTurns;
 *  3. abort() with an empty queue just stops (no extra turn);
 *  4. abort() on an idle session is a no-op ({ok:false}) that never touches
 *     the queue.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const BACKEND_PATH = path.resolve(__dirname, '..', 'main', 'backend.js');

function makeHarness(sessions) {
  const store = {
    async get(id) { return sessions[id] ?? null; },
    async setConfig(id, patch) { if (sessions[id]) Object.assign(sessions[id], patch); },
    async list() { return Object.values(sessions); },
    async appendTurn() {},
    async usageByDay() { return []; },
  };
  const fakeStoreMod = { createStore: () => store };
  const runCalls = [];
  const fakeClient = {
    runTurnImpl: async () => {},
    async runTurn(opts) {
      runCalls.push(opts);
      return this.runTurnImpl(opts);
    },
    runCalls,
  };

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

  const events = [];
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-abort-backend-'));
  return {
    backend,
    fakeClient,
    events,
    async init() {
      await backend.init({
        app: { getPath: () => userData },
        send: (payload) => events.push(payload),
      });
    },
    sessionEvents(type) {
      return events.filter((p) => p.type === 'session' && p.event?.type === type);
    },
    cleanup() {
      Module._load = origLoad;
      fs.rmSync(userData, { recursive: true, force: true });
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

/** runTurn impl: the first call blocks until the caller aborts it; later calls finish. */
function blockingFirstCall(h) {
  let calls = 0;
  h.fakeClient.runTurnImpl = (opts) => {
    calls += 1;
    if (calls > 1) return Promise.resolve();
    return new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      }, { once: true });
    });
  };
}

const SESSIONS = () => ({
  sid1: { id: 'sid1', cwd: '/tmp/x', model: 'k3', effort: 'high', permission: 'auto' },
});

test('abort auto-runs the next scheduled message as its own turn', async () => {
  const h = makeHarness(SESSIONS());
  await h.init();
  blockingFirstCall(h);
  try {
    await h.backend.sendPrompt('sid1', 'first');
    await tick();
    await h.backend.scheduleMessage('sid1', 'second');
    assert.equal((await h.backend.listScheduled('sid1')).length, 1);

    const result = await h.backend.abort('sid1');
    assert.equal(result.ok, true);

    // The interrupted turn unwound before the queued message started, and the
    // queued message became runTurn call #2 with its text intact.
    assert.equal(h.fakeClient.runCalls.length, 2);
    assert.equal(h.fakeClient.runCalls[1].prompt, 'second');

    // The renderer mirror hears the departure with reason 'started'.
    const updates = h.sessionEvents('scheduled.updated');
    const departed = updates.flatMap((p) => p.event.departed ?? []);
    assert.ok(departed.some((d) => d.reason === 'started' && d.text === 'second'));

    assert.equal((await h.backend.listScheduled('sid1')).length, 0);
  } finally {
    h.cleanup();
  }
});

test('abort with an empty queue only stops the turn', async () => {
  const h = makeHarness(SESSIONS());
  await h.init();
  blockingFirstCall(h);
  try {
    await h.backend.sendPrompt('sid1', 'first');
    await tick();
    const result = await h.backend.abort('sid1');
    assert.equal(result.ok, true);
    await tick();
    assert.equal(h.fakeClient.runCalls.length, 1, 'no follow-up turn without a queue');
  } finally {
    h.cleanup();
  }
});

test('abort on an idle session is a no-op and leaves the queue alone', async () => {
  const h = makeHarness(SESSIONS());
  await h.init();
  try {
    const result = await h.backend.abort('sid1');
    assert.equal(result.ok, false);
    assert.equal(h.fakeClient.runCalls.length, 0);
    assert.equal(h.sessionEvents('scheduled.updated').length, 0);
  } finally {
    h.cleanup();
  }
});
