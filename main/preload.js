'use strict';

/**
 * preload.js — exposes the minimal, fixed `window.kimi` API to the renderer.
 * contextIsolation is on and nodeIntegration is off; this is the only bridge.
 *
 * Request/response channels: `kimi:<name>` via ipcRenderer.invoke.
 * Server push events: main sends `kimi:event`; onEvent(cb) subscribes and
 * returns an unsubscribe function.
 *
 * V2 additions (CONTRACT-V2): onboarding (CLI install + login), bootstrapRetry,
 * listModels/setSessionModel/setSessionSwarm/listTasks, searchAll, and the
 * auto-update trio (updateCheck/updateQuitAndInstall/getAppVersion).
 */

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (name, ...args) => ipcRenderer.invoke(`kimi:${name}`, ...args);

contextBridge.exposeInMainWorld('kimi', {
  // { ready, version, defaultModel, error?, cliInstalled, loggedIn, needsOnboarding }
  getState: () => invoke('getState'),
  listSessions: () => invoke('listSessions'),
  createSession: ({ cwd } = {}) => invoke('createSession', { cwd }),
  // Native directory picker -> absolute path string | null
  pickDirectory: () => invoke('pickDirectory'),
  getMessages: (sessionId) => invoke('getMessages', sessionId),
  getProfile: (sessionId) => invoke('getProfile', sessionId),
  sendPrompt: (sessionId, text) => invoke('sendPrompt', sessionId, text),
  steer: (sessionId, text) => invoke('steer', sessionId, text),
  abort: (sessionId) => invoke('abort', sessionId),
  // decision: 'approve' | 'reject'
  respondApproval: (sessionId, approvalId, decision) =>
    invoke('respondApproval', sessionId, approvalId, decision),
  answerQuestion: (sessionId, tail, body) => invoke('answerQuestion', sessionId, tail, body),
  getQuota: () => invoke('getQuota'),
  openExternal: (url) => invoke('openExternal', url),

  // --- Onboarding (v2) -------------------------------------------------------
  // { cliInstalled, cliPath, cliVersion, loggedIn, needsOnboarding }
  onboardingGetState: () => invoke('onboardingGetState'),
  // -> { ok, cliPath }; progress pushed as {type:'onboarding', phase:'install', step, message}
  onboardingInstallCli: () => invoke('onboardingInstallCli'),
  // -> { verificationUrl, userCode }; completion pushed as
  // {type:'onboarding', phase:'login', status:'done'|'error', message?}
  onboardingStartLogin: () => invoke('onboardingStartLogin'),
  onboardingCancelLogin: () => invoke('onboardingCancelLogin'),
  // Re-run the backend launch after onboarding; returns the fresh getState().
  bootstrapRetry: () => invoke('bootstrapRetry'),

  // --- Chat options / agent work (v2) ----------------------------------------
  // -> [{ alias, model, displayName }] — `alias` is the model id (pass it to
  // setSessionModel; it matches getState().defaultModel).
  listModels: () => invoke('listModels'),
  setSessionModel: (sessionId, modelAlias) => invoke('setSessionModel', sessionId, modelAlias),
  // Swarm mode is settable per session (verified: profile agent_config.swarm_mode).
  setSessionSwarm: (sessionId, enabled) => invoke('setSessionSwarm', sessionId, enabled),
  // -> [{ id, session_id, kind, description, status, command?, created_at, ... }]
  listTasks: (sessionId) => invoke('listTasks', sessionId),

  // --- Content search (v2, M2 backend) ---------------------------------------
  // -> [{ sessionId, sessionTitle, cwd, messageId, role, snippet, createdAt }]
  searchAll: (query, limit) => invoke('searchAll', query, limit),

  // --- Auto-update (v2, M3 backend) ------------------------------------------
  // -> { status:'dev'|'checking'|'available'|'downloading'|'downloaded'|'none'|'error', ... }
  updateCheck: () => invoke('updateCheck'),
  updateQuitAndInstall: () => invoke('updateQuitAndInstall'),
  getAppVersion: () => invoke('getAppVersion'),

  /**
   * Subscribe to ALL push events:
   *   { type: 'status', ready, error? }
   *   { type: 'session', sessionId, event }   // raw session_event passthrough (snake_case)
   *   { type: 'usage', sessionId, usage }
   *   { type: 'onboarding', phase:'install'|'login', step?, message?, status? }  // v2
   *   { type: 'update', status, version?, message? }                             // v2 (M3)
   * Returns an unsubscribe function.
   */
  onEvent: (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('window.kimi.onEvent expects a callback function');
    }
    const listener = (_ipcEvent, payload) => callback(payload);
    ipcRenderer.on('kimi:event', listener);
    return () => {
      ipcRenderer.removeListener('kimi:event', listener);
    };
  },
});
