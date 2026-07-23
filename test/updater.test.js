'use strict';

const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const assert = require('node:assert/strict');

test('packaged update check reports an available release after IPC wiring', async () => {
  const fakeUpdater = new EventEmitter();
  let checkCalls = 0;
  fakeUpdater.checkForUpdates = async () => {
    checkCalls += 1;
    fakeUpdater.emit('checking-for-update');
    fakeUpdater.emit('update-available', { version: '9.9.9' });
    return { updateInfo: { version: '9.9.9' } };
  };
  fakeUpdater.downloadUpdate = async () => {};
  fakeUpdater.quitAndInstall = () => {};

  const handlers = new Map();
  const ipcMain = {
    handle(channel, callback) {
      handlers.set(channel, callback);
    },
  };
  const pushed = [];

  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === 'electron') return { app: { isPackaged: true } };
    if (request === 'electron-updater') return { autoUpdater: fakeUpdater };
    return originalLoad.call(this, request, parent, isMain);
  };

  const updaterPath = require.resolve('../main/updater');
  delete require.cache[updaterPath];
  try {
    const updater = require('../main/updater');
    updater.register({ ipcMain, send: (event) => pushed.push(event) });
    const check = handlers.get('kimi:updateCheck');
    assert.equal(typeof check, 'function');
    assert.equal(fakeUpdater.autoDownload, false);
    assert.equal(fakeUpdater.autoInstallOnAppQuit, true);
    assert.equal(checkCalls, 0, 'register must not check before the renderer subscribes');

    const result = await check();
    assert.equal(checkCalls, 1);
    assert.deepEqual(result, { status: 'available', version: '9.9.9' });
    assert.deepEqual(
      pushed.map(({ status, version }) => ({ status, version })),
      [
        { status: 'checking', version: undefined },
        { status: 'checking', version: undefined },
        { status: 'available', version: '9.9.9' },
      ],
    );
  } finally {
    Module._load = originalLoad;
    delete require.cache[updaterPath];
  }
});

test('renderer subscribes and gives the CLI dialog priority before launch check', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'renderer', 'js', 'app.js'),
    'utf8',
  );
  const boot = source.indexOf('async function bootMain()');
  const subscribe = source.indexOf('window.kimi.onEvent(handleEvent)', boot);
  const cliPrompt = source.indexOf('window.CliConnectPrompt?.show?.(state)', subscribe);
  const updateCheck = source.indexOf('void checkUpdatesOnLaunch()', cliPrompt);

  assert.ok(boot >= 0);
  assert.ok(subscribe > boot);
  assert.ok(cliPrompt > subscribe);
  assert.ok(updateCheck > cliPrompt);
});
