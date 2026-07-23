'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AUTH_REQUIRED_TAG,
  authRequiredError,
  isAuthRequiredError,
  requiresCliLogin,
} = require('../main/cli-auth-state');

test('managed Kimi provider status overrides a misleading ready flag', () => {
  assert.equal(requiresCliLogin({
    ready: true,
    providers_count: 1,
    default_model: 'kimi-code/k3',
    managed_provider: { name: 'managed:kimi-code', status: 'unauthenticated' },
  }), true);
  assert.equal(requiresCliLogin({
    ready: true,
    providers_count: 1,
    default_model: 'kimi-code/k3',
    managed_provider: { name: 'managed:kimi-code', status: 'authenticated' },
  }), false);
});

test('an unrelated configured provider is not blocked by dormant managed auth', () => {
  assert.equal(requiresCliLogin({
    ready: true,
    providers_count: 2,
    default_model: 'openai/gpt',
    managed_provider: { name: 'managed:kimi-code', status: 'unauthenticated' },
  }), false);
});

test('auth-required errors survive Electron IPC message wrapping', () => {
  const error = authRequiredError();
  assert.equal(error.code, 'KIMI_AUTH_REQUIRED');
  assert.match(error.message, new RegExp(AUTH_REQUIRED_TAG.replace(/[[\]]/g, '\\$&')));
  assert.equal(isAuthRequiredError(error), true);
  assert.equal(
    isAuthRequiredError(new Error(`Error invoking remote method: ${error.message}`)),
    true,
  );
});

test('CLI auth preflight runs before session creation and prompt submission', () => {
  const root = path.resolve(__dirname, '..');
  const backend = fs.readFileSync(path.join(root, 'main/backend.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'renderer/js/app.js'), 'utf8');
  const chat = fs.readFileSync(path.join(root, 'renderer/js/chat.js'), 'utf8');

  const createStart = backend.indexOf('async function createSession');
  const sendStart = backend.indexOf('async function sendPrompt');
  assert.ok(
    backend.indexOf('await assertCliCanPrompt(client)', createStart) <
    backend.indexOf('client.createSession', createStart),
  );
  assert.ok(
    backend.indexOf('await assertCliCanPrompt(client)', sendStart) <
    backend.indexOf('client.sendPrompt', sendStart),
  );
  assert.match(app, /window\.Settings\?\.open\?\.\('account'/);
  assert.match(chat, /result\?\.error/);
});
