/* sidebar.js — session list rendering, grouped by recency (오늘/이전). */
'use strict';

(function () {
  const DAY_MS = 24 * 60 * 60 * 1000;

  /** Short Korean relative time for an ISO timestamp. */
  function relTime(iso) {
    const t = Date.parse(iso || '');
    if (Number.isNaN(t)) return '';
    const diff = Date.now() - t;
    if (diff < 0) return '방금 전';
    if (diff < 60 * 1000) return '방금 전';
    if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))}분 전`;
    if (diff < DAY_MS) return `${Math.floor(diff / (60 * 60 * 1000))}시간 전`;
    if (diff < 7 * DAY_MS) return `${Math.floor(diff / DAY_MS)}일 전`;
    const d = new Date(t);
    return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  }

  /** Last path component of a working directory (macOS + Windows separators). */
  function basename(cwd) {
    if (!cwd) return '';
    const norm = String(cwd).replace(/[\\/]+$/, '');
    const parts = norm.split(/[\\/]/);
    return parts[parts.length - 1] || norm;
  }

  function isToday(iso) {
    const t = Date.parse(iso || '');
    if (Number.isNaN(t)) return false;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return t >= start.getTime();
  }

  function renderItem(session, state) {
    const el = document.createElement('div');
    el.className = 'session-item';
    el.dataset.sessionId = session.id;
    if (session.id === state.activeId) el.classList.add('active');
    if (session.busy) el.classList.add('busy');
    el.setAttribute('role', 'button');
    el.tabIndex = 0;

    const title = document.createElement('div');
    title.className = 'session-title';
    title.textContent = session.title || '새 대화';

    const meta = document.createElement('div');
    meta.className = 'session-meta';
    meta.textContent = [relTime(session.updatedAt), basename(session.cwd)]
      .filter(Boolean)
      .join(' · ');

    el.append(title, meta);
    const select = () => window.App?.selectSession(session.id);
    el.addEventListener('click', select);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        select();
      }
    });
    return el;
  }

  /** Render the full session list from App state (newest first, 오늘 then 이전). */
  function render(state) {
    const nav = document.getElementById('session-list');
    if (!nav) return;
    nav.textContent = '';
    const sessions = [...(state.sessions || [])].sort(
      (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)
    );
    const groups = new Map(); // label -> sessions; insertion order keeps 오늘 first
    for (const s of sessions) {
      const label = isToday(s.updatedAt) ? '오늘' : '이전';
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(s);
    }
    for (const [label, items] of groups) {
      const groupEl = document.createElement('div');
      groupEl.className = 'session-group';
      const labelEl = document.createElement('div');
      labelEl.className = 'session-group-label';
      labelEl.textContent = label;
      groupEl.appendChild(labelEl);
      for (const s of items) groupEl.appendChild(renderItem(s, state));
      nav.appendChild(groupEl);
    }
  }

  window.Sidebar = { render };
})();
