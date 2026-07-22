/* app.js — application store (window.App), boot sequence, global event dispatch. */
'use strict';

(function () {
  const $ = (sel) => document.querySelector(sel);
  const intFmt = new Intl.NumberFormat('ko-KR');
  const LAST_CWD_KEY = 'kimi.lastCwd';

  let refreshTimer = null;

  const App = {
    state: {
      ready: false,        // backend answered getState with ready:true
      version: null,
      defaultModel: null,
      sessions: [],        // [{ id, title, cwd, updatedAt, busy, usage? }]
      activeId: null,      // selected session id (null = draft new chat)
      view: 'chat',        // 'chat' | 'usage'
      serverReady: false,  // live WS/server status from 'status' events
    },

    /** Re-fetch the session list; re-render sidebar and header affordances. */
    async refreshSessions() {
      try {
        App.state.sessions = await window.kimi.listSessions();
      } catch (err) {
        console.error('listSessions failed', err);
        return;
      }
      const { sessions, activeId } = App.state;
      if (activeId && !sessions.some((s) => s.id === activeId)) {
        // The active session was deleted elsewhere.
        App.state.activeId = null;
        updateChatHeader();
        updateContextMeter(null);
        window.Chat?.renderMessages?.([]);
      }
      window.Sidebar?.render?.(App.state);
      updateAbortButton();
    },

    /** Select a session: highlight it, load its transcript and context meter. */
    async selectSession(id) {
      App.state.activeId = id;
      App.showView('chat');
      window.Sidebar?.render?.(App.state);
      updateChatHeader();
      try {
        const messages = await window.kimi.getMessages(id);
        if (App.state.activeId !== id) return; // user switched meanwhile
        window.Chat?.renderMessages?.(messages);
      } catch (err) {
        console.error('getMessages failed', err);
      }
      try {
        const profile = await window.kimi.getProfile(id);
        if (App.state.activeId !== id) return;
        updateContextMeter(profile?.usage);
      } catch (err) {
        console.error('getProfile failed', err);
      }
      updateAbortButton();
    },

    /** Enter draft mode: no active session; one is created lazily on first send. */
    startNewChat() {
      App.state.activeId = null;
      App.showView('chat');
      window.Sidebar?.render?.(App.state);
      updateChatHeader();
      updateContextMeter(null);
      window.Chat?.renderMessages?.([]);
      $('#composer')?.focus();
    },

    /**
     * Send a prompt. Creates a session lazily on first send, reusing the last
     * working directory when known, otherwise asking via the native picker.
     * Returns true when the prompt was dispatched.
     */
    async sendPrompt(text) {
      text = String(text ?? '').trim();
      if (!text || !App.state.serverReady) return false;
      try {
        let id = App.state.activeId;
        if (!id) {
          let cwd = null;
          try { cwd = localStorage.getItem(LAST_CWD_KEY); } catch (_) { /* ignore */ }
          if (!cwd) {
            cwd = await window.kimi.pickDirectory();
            if (!cwd) return false; // user cancelled the picker
            try { localStorage.setItem(LAST_CWD_KEY, cwd); } catch (_) { /* ignore */ }
          }
          const session = await window.kimi.createSession({ cwd });
          await App.refreshSessions();
          App.state.activeId = session.id;
          window.Sidebar?.render?.(App.state);
          updateChatHeader();
          window.Chat?.renderMessages?.([]);
          id = session.id;
        }
        await window.kimi.sendPrompt(id, text);
        scheduleRefreshSessions(); // pick up the busy state promptly
        return true;
      } catch (err) {
        console.error('sendPrompt failed', err);
        return false;
      }
    },

    /** Abort the active session's current turn. */
    abort() {
      const id = App.state.activeId;
      if (!id) return;
      window.kimi.abort(id).catch((err) => console.error('abort failed', err));
    },

    /** Toggle between the chat and usage views. */
    showView(name) {
      App.state.view = name === 'usage' ? 'usage' : 'chat';
      $('#chat-view').hidden = App.state.view !== 'chat';
      $('#usage-view').hidden = App.state.view !== 'usage';
      $('#usage-nav-btn').classList.toggle('active', App.state.view === 'usage');
      if (App.state.view === 'usage') window.Usage?.render?.(App.state);
    },
  };

  window.App = App;

  /* ---- header / composer helpers ---- */

  function updateChatHeader() {
    const session = App.state.sessions.find((s) => s.id === App.state.activeId);
    $('#chat-title').textContent = session?.title || '새 대화';
    $('#model-label').textContent = App.state.defaultModel || '';
    updateAbortButton();
  }

  function updateAbortButton() {
    const session = App.state.sessions.find((s) => s.id === App.state.activeId);
    $('#abort-btn').hidden = !session?.busy;
  }

  /** Compact "% of context window" pill in the chat header. */
  function updateContextMeter(usage) {
    const el = $('#context-meter');
    const used = Number(usage?.context_tokens ?? 0);
    const limit = Number(usage?.context_limit ?? 0);
    if (!limit) {
      el.textContent = '';
      el.removeAttribute('title');
      el.style.color = '';
      return;
    }
    const pct = Math.round((used / limit) * 100);
    el.textContent = `${pct}%`;
    el.title = `컨텍스트 ${intFmt.format(used)} / ${intFmt.format(limit)} 토큰`;
    el.style.color = pct >= 80 ? 'var(--warn)' : '';
  }

  function setServerStatus(ready, error) {
    App.state.serverReady = !!ready;
    const dot = $('#server-status');
    dot.classList.toggle('ok', !!ready);
    dot.classList.toggle('err', !ready);
    dot.title = ready
      ? '서버 연결됨'
      : `서버 연결 끊김${error ? `: ${error}` : ''}`;
  }

  function scheduleRefreshSessions() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => App.refreshSessions(), 150);
  }

  /* ---- push-event dispatch (window.kimi.onEvent) ---- */

  function handleEvent(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'status':
        setServerStatus(msg.ready, msg.error);
        if (msg.ready) App.refreshSessions(); // resync after reconnect
        break;
      case 'session':
        onSessionEvent(msg.event);
        break;
      case 'usage':
        if (msg.sessionId === App.state.activeId) updateContextMeter(msg.usage);
        if (App.state.view === 'usage') {
          window.Usage?.updateUsage?.(msg.sessionId, msg.usage);
        }
        break;
    }
  }

  function onSessionEvent(ev) {
    if (!ev) return;
    const type = String(ev.type || '');
    // Chat transcript and approval dialogs handle their own event kinds.
    window.Chat?.applyEvent?.(App.state.activeId, ev);
    window.Approvals?.maybeHandle?.(ev);
    // Session-lifecycle events change sidebar membership/title/busy state.
    if (/session\.(created|updated|deleted|status_changed|work_changed)/.test(type)) {
      scheduleRefreshSessions();
    }
  }

  /* ---- static chrome wiring ---- */

  function wireComposer() {
    const composer = $('#composer');
    const sendBtn = $('#send-btn');
    const autoresize = () => {
      composer.style.height = 'auto';
      composer.style.height = `${Math.min(composer.scrollHeight, 200)}px`;
    };
    composer.addEventListener('input', autoresize);
    composer.addEventListener('keydown', (e) => {
      // isComposing guards Korean IME: Enter must not send mid-composition.
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        void handleSend();
      }
    });
    sendBtn.addEventListener('click', () => void handleSend());

    async function handleSend() {
      const text = composer.value.trim();
      if (!text) return;
      sendBtn.disabled = true;
      try {
        if (await App.sendPrompt(text)) {
          composer.value = '';
          autoresize();
          composer.focus();
        }
      } finally {
        sendBtn.disabled = false;
      }
    }
  }

  function wireChrome() {
    $('#new-chat-btn').addEventListener('click', () => App.startNewChat());
    $('#usage-nav-btn').addEventListener('click', () => {
      App.showView(App.state.view === 'usage' ? 'chat' : 'usage');
    });
    $('#abort-btn').addEventListener('click', () => App.abort());
    $('#boot-retry-btn').addEventListener('click', () => location.reload());
    wireComposer();
    window.addEventListener('keydown', (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        App.startNewChat();
      } else if (e.key === ',') {
        e.preventDefault();
        App.showView('usage');
      }
    });
  }

  /* ---- boot ---- */

  function showBootError(message) {
    $('#boot-error-message').textContent = message || '알 수 없는 오류가 발생했습니다.';
    $('#boot-error').style.display = 'flex';
  }

  async function boot() {
    wireChrome();
    let state;
    try {
      if (!window.kimi) throw new Error('preload API(window.kimi)를 사용할 수 없습니다.');
      state = await window.kimi.getState();
    } catch (err) {
      showBootError(err?.message || String(err));
      return;
    }
    if (!state?.ready) {
      showBootError(
        state?.error || 'Kimi Code CLI를 찾을 수 없거나 로컬 서버를 시작하지 못했습니다.'
      );
      return;
    }
    App.state.ready = true;
    App.state.version = state.version ?? null;
    App.state.defaultModel = state.defaultModel ?? null;
    setServerStatus(true);
    window.kimi.onEvent(handleEvent);
    try {
      App.state.sessions = await window.kimi.listSessions();
    } catch (err) {
      console.error('listSessions failed', err);
      App.state.sessions = [];
    }
    window.Sidebar?.render?.(App.state);
    updateChatHeader();
    // Select the most recently updated session, or start in draft mode.
    const sorted = [...App.state.sessions].sort(
      (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)
    );
    if (sorted.length) await App.selectSession(sorted[0].id);
    else App.startNewChat();
  }

  void boot();
})();
