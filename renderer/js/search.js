/* search.js — Spotlight-style conversation search palette (v2).
 * Exposes window.Search = { toggle, open, close }. Classic script-tag IIFE:
 * talks to window.kimi (preload bridge), window.App (shell store) and
 * window.I18N; no imports.
 *
 * Wiring contract:
 * - DOM (index.html, R6): #search-palette > #search-input + #search-results,
 *   #search-open-btn in the sidebar header. All looked up lazily and guarded —
 *   the module degrades to a no-op while the DOM is absent.
 * - Backend (M2 via preload): window.kimi.searchAll(query) ->
 *   [ { sessionId, sessionTitle, cwd, messageId, role, snippet, createdAt } ]
 * - Open a hit: window.App.openSessionAtMessage(sessionId, messageId) (R6);
 *   falls back to App.selectSession(sessionId) until that lands.
 * - Styles: renderer/styles/search.css. Shortcut: ⌘F / Ctrl+F (capture phase).
 */
(function () {
  'use strict';

  const T = (k, f) => (window.I18N?.t ? window.I18N.t(k, f) : f);

  const DEBOUNCE_MS = 200;
  const SHIMMER_ROWS = 5;

  // ---- module state ----------------------------------------------------------
  let paletteEl = null;
  let inputEl = null;
  let resultsEl = null;

  let globalWired = false; // document-level shortcuts, wired once at script load
  let domWired = false;    // palette elements, wired lazily once the DOM exists

  let hits = [];           // flat hit list in display order (index === row index)
  let selectedIdx = -1;
  let debounceTimer = null;
  let querySeq = 0;        // stale-response guard, bumped per query/cancel
  let lastFocused = null;  // focus restore target for close()

  // ---- small helpers ---------------------------------------------------------
  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function isOpen() {
    return !!(paletteEl && !paletteEl.hidden);
  }

  function basename(cwd) {
    if (!cwd || typeof cwd !== 'string') return '';
    const parts = cwd.split(/[\\/]+/).filter(Boolean); // POSIX + Windows paths
    return parts.length ? parts[parts.length - 1] : '';
  }

  function roleLabel(role) {
    switch (role) {
      case 'user': return T('search.role.user', '사용자');
      case 'assistant': return T('search.role.assistant', '어시스턴트');
      case 'tool': return T('search.role.tool', '도구');
      case 'system': return T('search.role.system', '시스템');
      default: return role ? String(role) : '—';
    }
  }

  function relTime(v) {
    const n = typeof v === 'number' ? v : Date.parse(v);
    if (!Number.isFinite(n)) return '';
    const diff = Date.now() - n;
    if (diff < 45 * 1000) return T('search.time.just_now', '방금 전');
    const m = Math.floor(diff / 60000);
    if (m < 60) return T('search.time.minutes_ago', m + '분 전');
    const h = Math.floor(m / 60);
    if (h < 24) return T('search.time.hours_ago', h + '시간 전');
    const d = Math.floor(h / 24);
    if (d < 7) return T('search.time.days_ago', d + '일 전');
    try { return new Date(n).toLocaleDateString('ko-KR'); } catch { return ''; }
  }

  // Snippet with the (case-insensitive) query occurrence wrapped in <mark>.
  // Built from text nodes only — no HTML injection from server content.
  function snippetNode(snippet, query) {
    const span = el('span', 'search-result-snippet');
    const s = String(snippet ?? '');
    const q = String(query ?? '');
    const at = q ? s.toLowerCase().indexOf(q.toLowerCase()) : -1;
    if (at === -1) {
      span.textContent = s;
      return span;
    }
    span.append(document.createTextNode(s.slice(0, at)));
    const mark = document.createElement('mark');
    mark.textContent = s.slice(at, at + q.length);
    span.append(mark, document.createTextNode(s.slice(at + q.length)));
    return span;
  }

  // ---- DOM wiring --------------------------------------------------------------
  // Document-level handlers; bound once at script load so the shortcut works
  // regardless of when the palette DOM appears.
  function wireGlobal() {
    if (globalWired) return;
    globalWired = true;

    // ⌘F / Ctrl+F toggles the palette app-wide. Capture phase + preventDefault
    // so the shortcut beats any focused control. Left alone when the palette
    // DOM is absent (ensureDom false) — nothing to show anyway.
    document.addEventListener('keydown', (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (String(e.key).toLowerCase() !== 'f') return;
      if (!ensureDom()) return;
      e.preventDefault();
      e.stopPropagation();
      toggle();
    }, true);

    // Click outside the palette dismisses it (Spotlight behavior). The open
    // button is excluded: its click handler toggles, a close here would undo it.
    document.addEventListener('pointerdown', (e) => {
      if (!isOpen()) return;
      const t = e.target;
      if (paletteEl.contains(t)) return;
      if (t && typeof t.closest === 'function' && t.closest('#search-open-btn')) return;
      close();
    }, true);
  }

  // Palette elements; returns false (and stays retryable) while absent.
  function ensureDom() {
    if (domWired) return !!paletteEl;
    paletteEl = document.getElementById('search-palette');
    inputEl = document.getElementById('search-input');
    resultsEl = document.getElementById('search-results');
    if (!paletteEl || !inputEl || !resultsEl) {
      paletteEl = inputEl = resultsEl = null;
      return false;
    }
    domWired = true;

    paletteEl.setAttribute('role', 'dialog');
    paletteEl.setAttribute('aria-label', T('search.title', '대화 검색'));
    inputEl.setAttribute('placeholder', T('search.placeholder', '대화 내용 검색…'));
    inputEl.setAttribute('aria-label', T('search.placeholder', '대화 내용 검색…'));
    resultsEl.setAttribute('role', 'listbox');

    inputEl.addEventListener('input', onInput);
    inputEl.addEventListener('keydown', onInputKeydown);

    const btn = document.getElementById('search-open-btn'); // added by the shell
    if (btn && !btn.dataset.searchWired) {
      btn.dataset.searchWired = '1';
      btn.addEventListener('click', () => toggle());
    }
    return true;
  }

  // ---- querying ------------------------------------------------------------------
  function onInput() {
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    if (!inputEl.value.trim()) {
      querySeq++; // cancel any in-flight query
      hits = [];
      selectedIdx = -1;
      resultsEl.innerHTML = '';
      return;
    }
    debounceTimer = setTimeout(runQuery, DEBOUNCE_MS);
  }

  async function runQuery() {
    if (!inputEl) return;
    const query = inputEl.value.trim();
    const seq = ++querySeq;
    if (!query) { resultsEl.innerHTML = ''; return; }
    if (!window.kimi || typeof window.kimi.searchAll !== 'function') {
      hits = [];
      renderState(T('search.unavailable', '검색을 사용할 수 없습니다'));
      return;
    }
    renderShimmer();
    let list;
    try {
      list = await window.kimi.searchAll(query);
    } catch {
      if (seq !== querySeq) return; // superseded while awaiting
      hits = [];
      renderState(T('search.error', '검색 중 오류가 발생했습니다'));
      return;
    }
    if (seq !== querySeq) return; // superseded while awaiting
    hits = (Array.isArray(list) ? list : [])
      .filter((h) => h && typeof h === 'object' && h.sessionId != null);
    renderResults(query);
  }

  // ---- rendering -------------------------------------------------------------------
  function renderState(message) {
    resultsEl.removeAttribute('aria-busy');
    resultsEl.innerHTML = '';
    resultsEl.append(el('div', 'search-state', message));
  }

  function renderShimmer() {
    resultsEl.innerHTML = '';
    resultsEl.setAttribute('aria-busy', 'true');
    for (let i = 0; i < SHIMMER_ROWS; i++) {
      const row = el('div', 'search-shimmer-row');
      row.setAttribute('aria-hidden', 'true');
      row.append(
        el('span', 'search-shimmer-bar role'),
        el('span', 'search-shimmer-bar snippet'),
        el('span', 'search-shimmer-bar date'),
      );
      resultsEl.append(row);
    }
  }

  function renderResults(query) {
    resultsEl.removeAttribute('aria-busy');
    resultsEl.innerHTML = '';
    if (!hits.length) {
      renderState(T('search.empty', '검색 결과가 없습니다'));
      return;
    }
    // Group by session, preserving the backend's recency ranking (first-seen order).
    const groups = new Map(); // sessionId -> { title, cwd, items }
    for (const h of hits) {
      const key = String(h.sessionId);
      if (!groups.has(key)) {
        groups.set(key, { title: h.sessionTitle || '', cwd: h.cwd || '', items: [] });
      }
      groups.get(key).items.push(h);
    }
    let idx = 0;
    for (const g of groups.values()) {
      const box = el('div', 'search-group');
      const header = el('div', 'search-group-header');
      header.append(el('span', 'search-group-title', g.title || T('search.untitled', '제목 없음')));
      const dir = basename(g.cwd);
      if (dir) header.append(el('span', 'search-group-dir', dir));
      box.append(header);
      for (const h of g.items) box.append(buildRow(h, idx++, query));
      resultsEl.append(box);
    }
    select(hits.length ? 0 : -1); // first hit pre-selected, Spotlight-style
  }

  function buildRow(h, idx, query) {
    const row = el('div', 'search-result');
    row.id = 'search-opt-' + idx;
    row.dataset.sessionId = h.sessionId ?? '';
    row.dataset.messageId = h.messageId ?? '';
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', 'false');
    row.append(
      el('span', 'search-result-role', roleLabel(h.role)),
      snippetNode(h.snippet, query),
      el('span', 'search-result-date', relTime(h.createdAt)),
    );
    row.addEventListener('click', () => openHit(h));
    row.addEventListener('mousemove', () => { if (selectedIdx !== idx) select(idx); });
    return row;
  }

  function select(i) {
    selectedIdx = i;
    const rows = resultsEl.querySelectorAll('.search-result');
    rows.forEach((r, j) => {
      const on = j === i;
      r.classList.toggle('selected', on);
      r.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) {
        inputEl.setAttribute('aria-activedescendant', r.id);
        r.scrollIntoView({ block: 'nearest' });
      }
    });
    if (i < 0) inputEl.removeAttribute('aria-activedescendant');
  }

  // ---- keyboard nav ------------------------------------------------------------------
  function onInputKeydown(e) {
    if (e.isComposing) return; // IME (한글) owns keys during composition
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIdx >= 0 && hits[selectedIdx]) openHit(hits[selectedIdx]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  function move(d) {
    if (!hits.length) return;
    const n = hits.length;
    select(((selectedIdx + d) % n + n) % n); // wraps around both ends
  }

  // ---- open a hit ----------------------------------------------------------------------
  function openHit(h) {
    if (!h) return;
    const app = window.App;
    try {
      if (app && typeof app.openSessionAtMessage === 'function') {
        app.openSessionAtMessage(h.sessionId, h.messageId);
      } else if (app && typeof app.selectSession === 'function' && h.sessionId) {
        app.selectSession(h.sessionId); // fallback until R6 lands
      }
    } finally {
      close();
    }
  }

  // ---- public API ------------------------------------------------------------------------
  function open() {
    if (!ensureDom()) return;
    // Re-apply in case the language changed while the palette was hidden.
    inputEl.setAttribute('placeholder', T('search.placeholder', '대화 내용 검색…'));
    if (isOpen()) { inputEl.focus(); return; }
    lastFocused = document.activeElement;
    paletteEl.hidden = false;
    inputEl.focus();
    inputEl.select();
    // Reopened with a stale query but no rendered results: re-run it.
    if (inputEl.value.trim() && !resultsEl.childNodes.length) runQuery();
  }

  function close() {
    if (!paletteEl || paletteEl.hidden) return;
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    querySeq++; // ignore in-flight responses after close
    paletteEl.hidden = true;
    selectedIdx = -1;
    const t = lastFocused;
    lastFocused = null;
    if (t && document.contains(t) && typeof t.focus === 'function') t.focus();
  }

  function toggle() {
    if (isOpen()) close(); else open();
  }

  window.Search = { toggle, open, close };

  // Shortcuts work from script load; palette binds as soon as the DOM exists.
  wireGlobal();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureDom);
  } else {
    ensureDom();
  }
})();
