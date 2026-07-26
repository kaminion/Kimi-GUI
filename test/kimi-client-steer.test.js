'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { KimiClient } = require('../main/kimi-client');

test('CLI queuePrompt submits the text as a daemon-queued prompt', async () => {
  const client = new KimiClient({ baseUrl: 'http://127.0.0.1:1', token: 'test-token' });
  const calls = [];
  client.request = async (method, requestPath, body) => {
    calls.push({ method, requestPath, body });
    return { prompt_id: 'prompt_1', user_message_id: 'msg_1', status: 'queued' };
  };

  const submitted = await client.queuePrompt('session_1', 'Run this after the current turn.');
  assert.equal(submitted.prompt_id, 'prompt_1');
  assert.equal(submitted.status, 'queued');
  assert.deepEqual(calls, [{
    method: 'POST',
    requestPath: '/sessions/session_1/prompts',
    body: { content: [{ type: 'text', text: 'Run this after the current turn.' }] },
  }]);
});

test('CLI listQueuedPrompts maps the daemon queue to scheduled items', async () => {
  const client = new KimiClient({ baseUrl: 'http://127.0.0.1:1', token: 'test-token' });
  client.request = async (method, requestPath) => {
    assert.equal(method, 'GET');
    assert.equal(requestPath, '/sessions/session_1/prompts');
    return {
      active: { prompt_id: 'prompt_0' },
      queued: [
        {
          prompt_id: 'prompt_1',
          content: [{ type: 'text', text: 'First' }],
          created_at: '2026-01-01T00:00:00Z',
        },
        { prompt_id: 'prompt_2', content: [{ type: 'text', text: 'Second' }, { type: 'image' }] },
      ],
    };
  };

  const items = await client.listQueuedPrompts('session_1');
  assert.deepEqual(items, [
    { prompt_id: 'prompt_1', text: 'First', created_at: '2026-01-01T00:00:00Z' },
    { prompt_id: 'prompt_2', text: 'Second', created_at: null },
  ]);
});

test('CLI steerQueuedPrompts merges a queued prompt into the active turn', async () => {
  const client = new KimiClient({ baseUrl: 'http://127.0.0.1:1', token: 'test-token' });
  const calls = [];
  client.request = async (method, requestPath, body) => {
    calls.push({ method, requestPath, body });
    return { steered: true, prompt_ids: body.prompt_ids };
  };

  const result = await client.steerQueuedPrompts('session_1', 'prompt_1');
  assert.equal(result.steered, true);
  assert.deepEqual(calls, [{
    method: 'POST',
    requestPath: '/sessions/session_1/prompts:steer',
    body: { prompt_ids: ['prompt_1'] },
  }]);
});

test('CLI updateQueuedPrompt submits the replacement before aborting the original', async () => {
  const client = new KimiClient({ baseUrl: 'http://127.0.0.1:1', token: 'test-token' });
  const calls = [];
  client.request = async (method, requestPath) => {
    calls.push({ method, requestPath });
    if (requestPath === '/sessions/session_1/prompts') {
      return { prompt_id: 'prompt_2', status: 'queued' };
    }
    return { aborted: true };
  };

  const result = await client.updateQueuedPrompt('session_1', 'prompt_1', 'Revised');
  assert.equal(result.prompt_id, 'prompt_2');
  assert.equal(result.replaced_prompt_id, 'prompt_1');
  assert.deepEqual(calls, [
    { method: 'POST', requestPath: '/sessions/session_1/prompts' },
    { method: 'POST', requestPath: '/sessions/session_1/prompts/prompt_1:abort' },
  ]);
});

test('CLI updateQueuedPrompt rolls back the replacement when the original abort fails', async () => {
  const client = new KimiClient({ baseUrl: 'http://127.0.0.1:1', token: 'test-token' });
  const calls = [];
  client.request = async (method, requestPath) => {
    calls.push(requestPath);
    if (requestPath === '/sessions/session_1/prompts') {
      return { prompt_id: 'prompt_2', status: 'queued' };
    }
    if (requestPath === '/sessions/session_1/prompts/prompt_1:abort') {
      throw new Error('race with a running turn');
    }
    return { aborted: true }; // best-effort rollback of the replacement
  };

  await assert.rejects(
    () => client.updateQueuedPrompt('session_1', 'prompt_1', 'Revised'),
    /race with a running turn/,
  );
  assert.deepEqual(calls, [
    '/sessions/session_1/prompts',
    '/sessions/session_1/prompts/prompt_1:abort',
    '/sessions/session_1/prompts/prompt_2:abort',
  ]);
});

test('CLI cancelQueuedPrompt aborts the queued prompt', async () => {
  const client = new KimiClient({ baseUrl: 'http://127.0.0.1:1', token: 'test-token' });
  client.request = async (method, requestPath) => {
    assert.equal(method, 'POST');
    assert.equal(requestPath, '/sessions/session_1/prompts/prompt_1:abort');
    return { aborted: true, at_seq: 42 };
  };

  const result = await client.cancelQueuedPrompt('session_1', 'prompt_1');
  assert.equal(result.deleted, true);
  assert.equal(result.prompt_id, 'prompt_1');
});
