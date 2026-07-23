'use strict';

/**
 * permission-backend.test.js — backend harness for the per-session permission
 * flag (direct engine). Proves:
 *  1. setSessionPermission validates + persists {permission} via the store's
 *     setConfig (same patch path as setSessionEffort).
 *  2. hooks.requireApproval resolves 'approved' IMMEDIATELY under 'auto'
 *     without emitting approval.requested (and logs a line).
 *  3. Under 'ask' the current modal flow is kept: approval.requested is pushed
 *     and the hook promise settles only via respondApproval.
 *  4. A mid-turn flip ask -> auto takes effect on the NEXT requireApproval
 *     (live store re-read).
 *
 * ./direct-store and ./direct-client are stubbed via Module._load so no real
 * session tree, network, or electron runtime is touched (temp userData only).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const BACKEND_PATH = path.resolve(__dirname, '..', 'main', 'backend.js');

function makeHarness(sessions) {
  const storeCalls = [];
  const store = {
    async get(id) { return sessions[id] ?? null; },
    async setConfig(id, patch) {
      storeCalls.push(['setConfig', id, patch]);
      if (sessions[id]) Object.assign(sessions[id], patch);
    },
    async list() { return Object.values(sessions); },
    async appendTurn() {},
    async usageByDay() { return []; },
  };
  const fakeStoreMod = { createStore: () => store };
  const fakeClient = {
    runTurnImpl: async () => {},
    async runTurn(opts) { return this.runTurnImpl(opts); },
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
  // NOTE: keep the interception installed — backend requires the direct
  // modules LAZILY (first use), after this factory returns. cleanup() restores.

  const events = [];
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-perm-backend-'));
  return {
    backend,
    store,
    storeCalls,
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

test('setSessionPermission validates and persists via store.setConfig', async () => {
  const sessions = { sid1: { id: 'sid1', cwd: '/tmp/x', model: 'k3', effort: 'high' } };
  const h = makeHarness(sessions);
  await h.init();
  try {
    await h.backend.setSessionPermission('sid1', 'auto');
    assert.deepEqual(h.storeCalls, [['setConfig', 'sid1', { permission: 'auto' }]]);
    assert.equal(sessions.sid1.permission, 'auto');

    await assert.rejects(
      () => h.backend.setSessionPermission('sid1', 'yolo'),
      /unknown permission mode/,
    );
    await assert.rejects(
      () => h.backend.setSessionPermission('missing', 'auto'),
      /session not found/,
    );
  } finally {
    h.cleanup();
  }
});

test("requireApproval auto-approves under 'auto' without approval.requested", async () => {
  const sessions = {
    sid1: { id: 'sid1', cwd: '/tmp/x', model: 'k3', effort: 'high', permission: 'auto' },
  };
  const h = makeHarness(sessions);
  await h.init();
  const logLines = [];
  const origLog = console.log;
  console.log = (...args) => logLines.push(args.join(' '));
  const approvals = [];
  h.fakeClient.runTurnImpl = async (opts) => {
    approvals.push(await opts.hooks.requireApproval({ id: 'tool_1', name: 'Bash', input: { command: 'ls' } }));
  };
  try {
    await h.backend.sendPrompt('sid1', 'run ls');
    await tick();
    assert.deepEqual(approvals, ['approved']);
    assert.equal(h.sessionEvents('approval.requested').length, 0);
    assert.ok(logLines.some((l) => l.includes('permission=auto') && l.includes('auto-approved')));
  } finally {
    console.log = origLog;
    h.cleanup();
  }
});

test("requireApproval keeps the modal flow under 'ask'", async () => {
  const sessions = {
    sid1: { id: 'sid1', cwd: '/tmp/x', model: 'k3', effort: 'high', permission: 'ask' },
  };
  const h = makeHarness(sessions);
  await h.init();
  let hookResult = null;
  h.fakeClient.runTurnImpl = async (opts) => {
    hookResult = await opts.hooks.requireApproval({ id: 'tool_1', name: 'Bash', input: { command: 'ls' } });
  };
  try {
    await h.backend.sendPrompt('sid1', 'run ls');
    await tick();
    const requested = h.sessionEvents('approval.requested');
    assert.equal(requested.length, 1);
    assert.equal(requested[0].event.tool_name, 'Bash');
    assert.equal(hookResult, null, 'hook must still be pending on the modal');

    await h.backend.respondApproval('sid1', requested[0].event.approval_id, 'approve');
    await tick();
    assert.equal(hookResult, 'approved');
    assert.equal(h.sessionEvents('approval.resolved').length, 1);
  } finally {
    h.cleanup();
  }
});

test("mid-turn flip ask -> auto applies to the next requireApproval (live re-read)", async () => {
  const sessions = {
    sid1: { id: 'sid1', cwd: '/tmp/x', model: 'k3', effort: 'high', permission: 'ask' },
  };
  const h = makeHarness(sessions);
  await h.init();
  const results = [];
  h.fakeClient.runTurnImpl = async (opts) => {
    // First call: modal flow — test responds after approval.requested arrives.
    results.push(await opts.hooks.requireApproval({ id: 'tool_1', name: 'Bash' }));
    // Second call: after the flip to auto — must auto-approve.
    results.push(await opts.hooks.requireApproval({ id: 'tool_2', name: 'Write' }));
  };
  try {
    await h.backend.sendPrompt('sid1', 'run two tools');
    await tick();
    const requested = h.sessionEvents('approval.requested');
    assert.equal(requested.length, 1);
    await h.backend.setSessionPermission('sid1', 'auto');
    await h.backend.respondApproval('sid1', requested[0].event.approval_id, 'approve');
    await tick();
    assert.deepEqual(results, ['approved', 'approved']);
    assert.equal(h.sessionEvents('approval.requested').length, 1, 'no second modal under auto');
  } finally {
    h.cleanup();
  }
});
