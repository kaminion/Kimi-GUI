'use strict';

/**
 * main.js — Electron main process entry point.
 *
 * Lifecycle (per ARCHITECTURE.md):
 *   single-instance lock -> create BrowserWindow (1100x720, min 840x560,
 *   hiddenInset + sidebar vibrancy on macOS, contextIsolation on, no
 *   nodeIntegration) -> load renderer/index.html -> KimiClient.launch() ->
 *   wire IPC + event forwarding -> graceful shutdown on before-quit.
 *
 * main/kimi-client.js is provided by another agent; the require is lazy so
 * this file loads (and syntax-checks) even while that file is absent.
 */

const { app, BrowserWindow } = require('electron');
const path = require('node:path');

const { registerIpc, wireClientEvents } = require('./ipc');

const isMac = process.platform === 'darwin';

/** @type {BrowserWindow | null} */
let mainWindow = null;
let isQuitting = false;

// Backend state mirrored for kimi:getState and status pushes.
const state = {
  client: null,
  token: null,
  ready: false,
  version: null,
  defaultModel: null,
  error: null,
};

// Lazy: another agent owns main/kimi-client.js.
function loadKimiClient() {
  try {
    // eslint-disable-next-line global-require
    return require('./kimi-client');
  } catch (err) {
    const wrapped = new Error(`failed to load main/kimi-client.js: ${err.message}`);
    wrapped.cause = err;
    throw wrapped;
  }
}

function broadcast(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('kimi:event', payload);
  }
}

function getAppState() {
  return {
    ready: state.ready,
    version: state.version,
    defaultModel: state.defaultModel,
    ...(state.error ? { error: state.error } : {}),
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 840,
    minHeight: 560,
    ...(isMac ? { titleBarStyle: 'hiddenInset', vibrancy: 'sidebar' } : {}),
    backgroundColor: '#f5f5f7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  // Renderer must use window.kimi.openExternal; never open new windows.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // A (re)loaded renderer learns the current backend status immediately.
  mainWindow.webContents.on('did-finish-load', () => {
    broadcast({ type: 'status', ready: state.ready, ...(state.error ? { error: state.error } : {}) });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

/** Full-screen fatal error page (Korean UI copy) when the CLI is missing. */
function showFatalErrorPage(err) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const message = String(err && err.message ? err.message : err).slice(0, 500);
  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>Kimi Desktop</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         display: flex; align-items: center; justify-content: center; height: 100vh;
         margin: 0; background: #f5f5f7; color: #1d1d1f; }
  main { max-width: 520px; padding: 32px; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  p { font-size: 13px; line-height: 1.6; color: #6e6e73; margin: 8px 0; }
  code { font-family: 'SF Mono', Menlo, monospace; font-size: 12px;
         background: rgba(0,0,0,0.05); padding: 1px 5px; border-radius: 4px; }
  .detail { margin-top: 16px; font-size: 11px; color: #86868b; word-break: break-all; }
</style></head>
<body><main>
  <h1>Kimi Code CLI를 찾을 수 없습니다</h1>
  <p>Kimi Desktop을 사용하려면 Kimi Code CLI(<code>kimi</code>)가 설치되어 있어야 합니다.</p>
  <p>확인한 경로: <code>KIMI_CLI_PATH</code> 환경 변수, <code>PATH</code>, <code>~/.kimi-code/bin/kimi</code></p>
  <p class="detail"></p>
</main></body></html>`;
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  mainWindow.loadURL(url);
  // Put the detail text in safely after load (avoid HTML-escaping issues above).
  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(
      `document.querySelector('.detail').textContent = ${JSON.stringify(message)}`,
    );
  });
}

async function launchBackend() {
  let client;
  let child;
  let token;
  let baseUrl;
  try {
    const KimiClient = loadKimiClient();
    ({ client, child, baseUrl, token } = await KimiClient.launch({}));
  } catch (err) {
    state.ready = false;
    state.error = err.message;
    console.error(`[kimi-desktop] backend launch failed: ${state.error}`);
    broadcast({ type: 'status', ready: false, error: state.error });
    const cliMissing =
      err.code === 'KIMI_CLI_NOT_FOUND' || /not found|ENOENT/i.test(String(err.message));
    if (cliMissing) showFatalErrorPage(err);
    return;
  }

  state.client = client;
  state.token = token;
  state.ready = true;
  state.error = null;
  wireClientEvents(client, broadcast);
  console.log(`[kimi-desktop] backend ready at ${baseUrl}`);

  // Best-effort metadata for getState(); failures must not break the launch.
  try {
    const meta = await client.meta();
    state.version = (meta && meta.server_version) ?? null;
  } catch {
    state.version = null;
  }
  try {
    const auth = await client.auth();
    state.defaultModel = (auth && auth.default_model) ?? null;
  } catch {
    state.defaultModel = null;
  }
  broadcast({ type: 'status', ready: true });

  // If the server process dies on its own, surface it as a status error.
  if (child) {
    child.once('exit', (code, signal) => {
      if (isQuitting) return;
      state.ready = false;
      state.client = null;
      state.token = null;
      state.error = `kimi server exited unexpectedly (code ${code}, signal ${signal})`;
      broadcast({ type: 'status', ready: false, error: state.error });
    });
  }
}

// --- App lifecycle -------------------------------------------------------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerIpc({
      getClient: () => state.client,
      getAppState,
      getToken: () => state.token,
      getWindow: () => mainWindow,
      broadcast,
    });
    createWindow();
    launchBackend();
  });

  // Single-window utility: closing the window quits the app (and the server).
  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', (event) => {
    if (isQuitting || !state.client) return;
    isQuitting = true;
    event.preventDefault();
    const shutdown = Promise.resolve()
      .then(() => state.client.shutdown())
      .catch((err) => console.warn(`[kimi-desktop] client shutdown failed: ${err.message}`));
    const timeout = new Promise((resolve) => setTimeout(resolve, 3000));
    Promise.race([shutdown, timeout]).finally(() => app.quit());
  });

  // Make Ctrl+C / kill during development also shut the server down cleanly.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => app.quit());
  }
}
