'use strict';

/**
 * preload.js — exposes the minimal, fixed `window.kimi` API to the renderer.
 * contextIsolation is on and nodeIntegration is off; this is the only bridge.
 *
 * Request/response channels: `kimi:<name>` via ipcRenderer.invoke.
 * Server push events: main sends `kimi:event`; onEvent(cb) subscribes and
 * returns an unsubscribe function.
 */

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (name, ...args) => ipcRenderer.invoke(`kimi:${name}`, ...args);

contextBridge.exposeInMainWorld('kimi', {
  // { ready, version, defaultModel, error? }
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

  /**
   * Subscribe to ALL push events:
   *   { type: 'status', ready, error? }
   *   { type: 'session', sessionId, event }   // raw session_event passthrough (snake_case)
   *   { type: 'usage', sessionId, usage }
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
