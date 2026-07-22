'use strict';

/**
 * ipc.js — registers every `kimi:<name>` ipcMain.handle backing the window.kimi
 * preload API, plus push-event forwarding from KimiClient to the renderer via
 * webContents.send('kimi:event', payload).
 *
 * registerIpc({
 *   getClient,   // () => KimiClient | null (null until the server is up / after failure)
 *   getAppState, // () => ({ ready, version, defaultModel, error? })
 *   getToken,    // () => string | null   (server bearer token; never logged)
 *   getWindow,   // () => BrowserWindow | null
 *   broadcast,   // (payload) => void     (already targets the main window)
 * })
 *
 * wireClientEvents(client, broadcast) attaches 'event'/'usage'/'status'
 * forwarding to a freshly launched client.
 */

const { ipcMain, dialog, shell } = require('electron');

// Lazy: main/quota.js is owned by another agent and may not exist yet.
let quotaModule = null;
let quotaLoadFailed = false;
function loadQuota() {
  if (quotaModule || quotaLoadFailed) return quotaModule;
  try {
    // eslint-disable-next-line global-require
    quotaModule = require('./quota');
  } catch {
    quotaLoadFailed = true;
    quotaModule = null;
  }
  return quotaModule;
}

function requireClient(getClient) {
  const client = getClient();
  if (!client) {
    throw new Error('kimi server is not running (backend not ready)');
  }
  return client;
}

function registerIpc({ getClient, getAppState, getToken, getWindow }) {
  const handle = (name, fn) => {
    ipcMain.handle(`kimi:${name}`, (_event, ...args) => fn(...args));
  };

  handle('getState', () => getAppState());

  handle('listSessions', () => requireClient(getClient).listSessions());

  handle('createSession', ({ cwd } = {}) => requireClient(getClient).createSession({ cwd }));

  handle('pickDirectory', async () => {
    const options = {
      title: '작업 폴더 선택', // pick a working directory for the new session
      properties: ['openDirectory', 'createDirectory'],
    };
    const win = getWindow();
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  handle('getMessages', (sessionId) => requireClient(getClient).getMessages(sessionId));

  handle('getProfile', (sessionId) => requireClient(getClient).getProfile(sessionId));

  handle('sendPrompt', (sessionId, text) => requireClient(getClient).sendPrompt(sessionId, text));

  handle('steer', (sessionId, text) => requireClient(getClient).steer(sessionId, text));

  handle('abort', (sessionId) => requireClient(getClient).abort(sessionId));

  handle('respondApproval', (sessionId, approvalId, decision) =>
    requireClient(getClient).respondApproval(sessionId, approvalId, decision),
  );

  handle('answerQuestion', (sessionId, tail, body) =>
    requireClient(getClient).answerQuestion(sessionId, tail, body),
  );

  handle('getQuota', async () => {
    const quota = loadQuota();
    if (!quota || typeof quota.getQuota !== 'function') return null;
    try {
      return await quota.getQuota({ token: getToken() ?? undefined });
    } catch (err) {
      console.warn(`[kimi-desktop] getQuota failed: ${err.message}`);
      return null; // UI falls back to per-session usage only
    }
  });

  handle('openExternal', async (url) => {
    // Security boundary: only http(s) URLs may leave the app.
    let parsed;
    try {
      parsed = new URL(String(url));
    } catch {
      throw new Error(`invalid URL: ${String(url).slice(0, 100)}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`blocked URL scheme: ${parsed.protocol}`);
    }
    await shell.openExternal(parsed.toString());
  });
}

/** Forward KimiClient emissions to the renderer as kimi:event payloads. */
function wireClientEvents(client, broadcast) {
  const safe = (fn) => (...args) => {
    try {
      fn(...args);
    } catch (err) {
      console.error(`[kimi-desktop] event forwarding failed: ${err.message}`);
    }
  };
  client.on(
    'event',
    safe(({ sessionId, event } = {}) => broadcast({ type: 'session', sessionId, event })),
  );
  client.on(
    'usage',
    safe(({ sessionId, usage } = {}) => broadcast({ type: 'usage', sessionId, usage })),
  );
  client.on(
    'status',
    safe(({ ready, error } = {}) => broadcast({ type: 'status', ready, ...(error ? { error } : {}) })),
  );
}

module.exports = { registerIpc, wireClientEvents };
