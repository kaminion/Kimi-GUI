/* chat-options.js — composer options row (v3).
 * window.ChatOptions = { init(), refresh(sessionId), applyPending(sessionId) }
 *
 * The options cluster lives in #composer-options (inside #composer-wrap, below
 * the textarea) since v3; v2 kept it in the chat header. Row order (v7):
 * model → thinking effort → permission → swarm.
 *
 * #model-select opens a custom dropdown: models from window.kimi.listModels();
 * picking one calls window.kimi.setSessionModel() and persists the alias per
 * session (localStorage). Pill label = per-session override, else the session's
 * server-side model, else the server default (getState().defaultModel).
 * Pill stays hidden when listModels is not exposed by the preload.
 *
 * #swarm-toggle renders in BOTH engines (v4): fully wired when
 * window.kimi.setSessionSwarm exists (the cli engine exposes it); rendered
 * but disabled (.disabled + aria-disabled, click no-op, explanatory title)
 * when the direct engine omits it. Fresh cli sessions seed their on/off state
 * from localStorage 'kimi.defaultSwarm' (settings '스웜 기본값') when no
 * per-session value exists. State is per-session, optimistic UI with revert
 * on failure. v7: the pill opens an explicit ON/OFF dropdown with desc lines
 * (same pattern as effort/permission) — the daemon's agent_config.swarm_mode
 * is boolean-only (verified: openapi 0.28.1 profile schema, protocol.md), so
 * there are no richer swarm parameters (agent count etc.) to expose.
 *
 * #effort-select (v3) is shown ONLY when window.kimi.setSessionEffort exists.
 * Per-session thinking level off/low/high/max (끄기/낮음/높음/최대, default
 * 높음) persisted in localStorage 'kimi.sessionEffort.<sid>'; selecting a level
 * calls setSessionEffort() optimistically and reverts on failure. Dropdown
 * styling/behavior is identical to the model dropdown (same .model-dropdown
 * classes), anchored to the pill and flipped above it when near the window
 * bottom — the composer sits at the bottom edge, so this is the common case.
 *
 * #permission-select (v6) mirrors the effort pill exactly and renders in BOTH
 * engines (unlike swarm). Per-session permission mode persisted in localStorage
 * 'kimi.sessionPerm.<sid>'; selecting a mode calls setSessionPermission()
 * optimistically and reverts on failure. Options depend on the engine:
 * direct → 확인 후 실행(ask, default) / 자동 승인(auto); cli → 수동(manual,
 * default) / 자동(auto) / YOLO(yolo). Dropdown items carry a short desc line.
 *
 * Draft chat (no session yet, v7): every pill stays usable. Picks are stored
 * as one-shot pending values ('kimi.pendingModel' / 'kimi.pendingSwarm' /
 * 'kimi.pendingEffort' / 'kimi.pendingPerm') and pill titles carry the
 * '새 대화에 적용' hint; app.js calls applyPending(sessionId) right after
 * createSession, which applies them over the Settings defaults and clears
 * them. (The old draft swarm toggle mutated the global settings default —
 * gone.) Pending values invalid for the live engine are dropped without IPC.
 *
 * All copy via T() ('options.*' keys, Korean fallback).
 */
(function () {
  'use strict';

  const T = (k, f) => (window.I18N?.t ? window.I18N.t(k, f) : f);

  const LS_MODEL = 'kimi.sessionModel.'; // + sessionId -> model alias
  const LS_SWARM = 'kimi.sessionSwarm.'; // + sessionId -> '1' | '0'
  const LS_EFFORT = 'kimi.sessionEffort.'; // + sessionId -> 'off'|'low'|'high'|'max'
  const LS_PERM = 'kimi.sessionPerm.'; // + sessionId -> direct 'ask'|'auto', cli 'manual'|'auto'|'yolo'
  const LS_DEFAULT_SWARM = 'kimi.defaultSwarm'; // v4: settings '스웜 기본값' -> '1' | '0'
  // v7: one-shot draft-chat picks, applied to the next created session.
  const LS_PENDING_MODEL = 'kimi.pendingModel'; // model alias
  const LS_PENDING_SWARM = 'kimi.pendingSwarm'; // '1' | '0'
  const LS_PENDING_EFFORT = 'kimi.pendingEffort'; // 'off'|'low'|'high'|'max'
  const LS_PENDING_PERM = 'kimi.pendingPerm'; // engine permission mode

  const EFFORT_LEVELS = ['off', 'low', 'high', 'max'];
  const DEFAULT_EFFORT = 'high';
  const EFFORT_FALLBACKS = { off: '끄기', low: '낮음', high: '높음', max: '최대' };

  // Permission modes per engine (v6). Defaults match the backend: direct
  // sessions ask per tool, cli sessions start in the daemon's manual mode.
  const PERMISSION_MODES = {
    direct: ['ask', 'auto'],
    cli: ['manual', 'auto', 'yolo'],
  };
  const DEFAULT_PERMISSION = { direct: 'ask', cli: 'manual' };
  const PERMISSION_FALLBACKS = {
    ask: '확인 후 실행',
    auto: '자동 승인',
    manual: '수동',
    yolo: 'YOLO',
  };
  const PERMISSION_DESC_FALLBACKS = {
    ask: '도구 실행마다 확인합니다',
    auto: '도구 실행을 자동 승인합니다',
    manual: '도구 실행마다 확인합니다',
    yolo: '승인 없이 전부 실행합니다',
  };
  const SWARM_DESC_FALLBACKS = {
    on: '병렬 서브에이전트로 탐색/작업합니다',
    off: '단일 에이전트로 실행합니다',
  };

  const $ = (sel) => document.querySelector(sel);

  let modelPill = null;   // #model-select
  let swarmBtn = null;    // #swarm-toggle
  let effortPill = null;  // #effort-select
  let permPill = null;    // #permission-select
  let dropdown = null;    // open .model-dropdown element (null = closed)
  let dropdownOwner = null; // pill the open dropdown is anchored to

  function lsGet(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
  function lsSet(key, val) { try { localStorage.setItem(key, val); } catch (_) { /* ignore */ } }
  function lsRemove(key) { try { localStorage.removeItem(key); } catch (_) { /* ignore */ } }

  function activeSessionId() {
    const st = window.App?.state;
    return st?.activeSessionId ?? st?.activeId ?? null;
  }

  /** v7: pill-title suffix announcing that a draft-chat pick applies to the
   * upcoming conversation (' · 새 대화에 적용'); empty inside a session. */
  function draftHint(sid) {
    return sid ? '' : ` · ${T('options.draft_hint', '새 대화에 적용')}`;
  }

  /* ---- shared dropdown machinery (all pills) ---- */

  function closeDropdown(restoreFocus) {
    if (dropdown) dropdown.remove();
    const owner = dropdownOwner;
    dropdown = null;
    dropdownOwner = null;
    document.removeEventListener('mousedown', onDocMouseDown, true);
    document.removeEventListener('keydown', onDropdownKey, true);
    if (restoreFocus) owner?.focus?.();
  }

  function onDocMouseDown(e) {
    if (!dropdown) return;
    if (dropdown.contains(e.target) || dropdownOwner?.contains(e.target)) return;
    closeDropdown();
  }

  function onDropdownKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeDropdown(true);
    }
  }

  /** Anchor the dropdown to its owner pill; clamp horizontally, flip above
   * the pill when it would overflow the bottom of the window (composer row
   * sits at the bottom edge). Safe to call again after content changes. */
  function placeDropdown() {
    if (!dropdown || !dropdownOwner) return;
    const r = dropdownOwner.getBoundingClientRect();
    dropdown.style.left = `${Math.max(8, r.left)}px`;
    dropdown.style.top = `${r.bottom + 4}px`;
    let dr = dropdown.getBoundingClientRect();
    if (dr.right > window.innerWidth - 8) {
      dropdown.style.left = `${Math.max(8, window.innerWidth - 8 - dr.width)}px`;
    }
    dr = dropdown.getBoundingClientRect();
    if (dr.bottom > window.innerHeight - 8) {
      dropdown.style.top = `${Math.max(8, r.top - dr.height - 4)}px`;
    }
  }

  function dropdownItem(label, current, onSelect, desc) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'model-dropdown-item';
    item.setAttribute('role', 'option');
    const check = document.createElement('span');
    check.className = 'model-dropdown-check';
    check.textContent = label === current ? '✓' : '';
    const text = document.createElement('span');
    text.className = 'model-dropdown-label';
    text.textContent = label;
    if (desc) {
      // Short desc line under the label (permission dropdown). Styled here to
      // keep the change inside this file — no stylesheet edit needed.
      const d = document.createElement('span');
      d.className = 'model-dropdown-desc';
      d.textContent = desc;
      d.style.display = 'block';
      d.style.fontSize = '11px';
      d.style.opacity = '0.62';
      d.style.marginTop = '1px';
      text.appendChild(d);
    }
    item.append(check, text);
    if (label === current) {
      item.classList.add('current');
      item.setAttribute('aria-selected', 'true');
    }
    item.addEventListener('click', () => void onSelect());
    return item;
  }

  function dropdownNote(text) {
    const note = document.createElement('div');
    note.className = 'model-dropdown-note';
    note.textContent = text;
    return note;
  }

  /** Open (or replace) a dropdown anchored to `pill`; fill() appends content
   * and may be async — the dropdown is re-placed once it resolves. */
  function openDropdown(pill, fill) {
    closeDropdown();
    dropdown = document.createElement('div');
    dropdown.className = 'model-dropdown';
    dropdown.setAttribute('role', 'listbox');
    dropdownOwner = pill;
    document.body.appendChild(dropdown);
    document.addEventListener('mousedown', onDocMouseDown, true);
    document.addEventListener('keydown', onDropdownKey, true);
    placeDropdown();
    Promise.resolve()
      .then(() => fill(dropdown))
      .then(() => placeDropdown())
      .catch((err) => console.error('dropdown fill failed', err));
  }

  function toggleDropdownFor(pill, fill) {
    if (dropdown && dropdownOwner === pill) { closeDropdown(); return; }
    openDropdown(pill, fill);
  }

  /* ---- model pill + dropdown ---- */

  /** Model alias shown on the pill: per-session override, else the session's
   * server-side model (listSessions), else the server default. Draft chat
   * shows what the first send will apply: a pending pick, else the Settings
   * default, else the server default. */
  function currentModel(sessionId) {
    if (sessionId) {
      const stored = lsGet(LS_MODEL + sessionId);
      if (stored) return stored;
      const sessionModel = window.App?.state?.sessions?.find?.((s) => s && s.id === sessionId)?.model;
      if (sessionModel) return sessionModel;
      return window.App?.state?.defaultModel ?? null;
    }
    return (
      lsGet(LS_PENDING_MODEL) ??
      window.Settings?.getDefaultModel?.() ??
      window.App?.state?.defaultModel ??
      null
    );
  }

  function updateModelPill(sessionId) {
    if (!modelPill) return;
    const model = currentModel(sessionId);
    modelPill.textContent = model || T('options.model.none', '모델');
    modelPill.title = sessionId
      ? T('options.model.pick_title', '모델 선택 — 현재 대화에 적용')
      : T('options.model.pick_title_new', '모델 선택 — 새 대화에 적용');
  }

  async function fillModelDropdown(box) {
    const sid = activeSessionId();
    box.appendChild(dropdownNote(T('options.model.loading', '불러오는 중…')));
    let models = [];
    try { models = (await window.kimi.listModels()) ?? []; }
    catch (err) { console.error('listModels failed', err); }
    if (box !== dropdown) return; // closed/replaced while loading
    box.textContent = '';
    if (!Array.isArray(models) || !models.length) {
      box.appendChild(dropdownNote(T('options.model.empty', '사용 가능한 모델이 없습니다')));
      return;
    }
    const current = currentModel(sid);
    for (const m of models) {
      const alias = m?.alias ?? m?.model ?? String(m);
      box.appendChild(dropdownItem(alias, current, () => selectModel(alias)));
    }
  }

  async function selectModel(alias) {
    const sid = activeSessionId();
    closeDropdown();
    if (!sid) {
      // Draft chat: one-shot pending pick — app.js applies it right after
      // createSession via ChatOptions.applyPending().
      lsSet(LS_PENDING_MODEL, alias);
      updateModelPill(null);
      return;
    }
    try {
      await window.kimi.setSessionModel(sid, alias);
      lsSet(LS_MODEL + sid, alias);
      updateModelPill(sid);
    } catch (err) {
      console.error('setSessionModel failed', err);
    }
  }

  /* ---- swarm pill + dropdown (v7: explicit ON/OFF, was a flip toggle) ---- */

  function swarmEnabled(sid) {
    if (!sid) {
      // Draft chat: a pending pick wins; otherwise mirror what app.js will
      // apply on session creation — the settings default (스웜 기본값).
      const pending = lsGet(LS_PENDING_SWARM);
      if (pending === '1' || pending === '0') return pending === '1';
      return lsGet(LS_DEFAULT_SWARM) === '1';
    }
    const stored = lsGet(LS_SWARM + sid);
    if (stored === '1' || stored === '0') return stored === '1';
    // v4: fresh session with no per-session value — seed from the settings
    // default (스웜 기본값) so the pill matches what app.js applied.
    return lsGet(LS_DEFAULT_SWARM) === '1';
  }

  function swarmAvailable() {
    // Preload capabilities are captured before renderer boot. An automatic
    // CLI -> direct fallback can therefore change the live engine without a
    // reload, so also consult App.state instead of trusting the API shape.
    return (
      window.App?.state?.engine === 'cli' &&
      typeof window.kimi?.setSessionSwarm === 'function'
    );
  }

  function renderSwarmState(on) {
    if (!swarmBtn) return;
    swarmBtn.textContent = '';
    const label = document.createElement('span');
    label.className = 'swarm-label';
    label.textContent = T('options.swarm.label', '스웜');
    const state = document.createElement('span');
    state.className = 'swarm-state';
    state.textContent = on
      ? T('options.swarm.on', 'ON')
      : T('options.swarm.off', 'OFF');
    swarmBtn.append(label, state);
    swarmBtn.classList.toggle('on', on);
    swarmBtn.classList.toggle('off', !on);
  }

  function updateSwarm(sid) {
    if (!swarmBtn || swarmBtn.hidden) return;
    // v4: engine without swarm (direct) — inert pill, explanatory title.
    if (!swarmAvailable()) {
      swarmBtn.classList.add('disabled');
      renderSwarmState(false);
      swarmBtn.setAttribute('aria-disabled', 'true');
      swarmBtn.setAttribute('aria-pressed', 'false');
      swarmBtn.title = T('options.swarm.unavailable', '스웜은 CLI 에이전트 모드에서 사용할 수 있습니다');
      swarmBtn.setAttribute(
        'aria-label',
        T('options.swarm.label', '스웜') + ' ' + T('options.swarm.off', 'OFF'),
      );
      return;
    }
    swarmBtn.classList.remove('disabled');
    swarmBtn.removeAttribute('aria-disabled');
    const on = swarmEnabled(sid);
    renderSwarmState(on);
    swarmBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    const stateText = on ? T('options.swarm.on', 'ON') : T('options.swarm.off', 'OFF');
    swarmBtn.title =
      T('options.swarm.title', '스웜 — 병렬 서브에이전트로 탐색/작업') +
      ` · ${stateText}` +
      draftHint(sid);
    swarmBtn.setAttribute('aria-label', T('options.swarm.label', '스웜') + ' ' + stateText);
  }

  function fillSwarmDropdown(box) {
    const on = swarmEnabled(activeSessionId());
    const onLabel = T('options.swarm.on', 'ON');
    const offLabel = T('options.swarm.off', 'OFF');
    const current = on ? onLabel : offLabel;
    box.appendChild(
      dropdownItem(onLabel, current, () => selectSwarm(true),
        T('options.swarm.on_desc', SWARM_DESC_FALLBACKS.on))
    );
    box.appendChild(
      dropdownItem(offLabel, current, () => selectSwarm(false),
        T('options.swarm.off_desc', SWARM_DESC_FALLBACKS.off))
    );
  }

  async function selectSwarm(next) {
    const sid = activeSessionId();
    closeDropdown();
    if (!swarmAvailable()) return;
    if (!sid) {
      // Draft chat: one-shot pending pick (replaces the old behavior of
      // mutating the global settings default from the composer).
      lsSet(LS_PENDING_SWARM, next ? '1' : '0');
      updateSwarm(null);
      return;
    }
    if (next === swarmEnabled(sid)) return; // picked the current state
    lsSet(LS_SWARM + sid, next ? '1' : '0'); // optimistic
    updateSwarm(sid);
    try {
      await window.kimi.setSessionSwarm(sid, next);
    } catch (err) {
      console.error('setSessionSwarm failed', err);
      lsSet(LS_SWARM + sid, next ? '0' : '1'); // revert
      updateSwarm(sid);
    }
  }

  /* ---- effort pill + dropdown (v3) ---- */

  function currentEffort(sid) {
    // Draft chat reads the one-shot pending level instead of a per-session key.
    const stored = sid ? lsGet(LS_EFFORT + sid) : lsGet(LS_PENDING_EFFORT);
    return EFFORT_LEVELS.includes(stored) ? stored : DEFAULT_EFFORT;
  }

  function effortLabel(level) {
    return T(`options.effort.${level}`, EFFORT_FALLBACKS[level] || level);
  }

  function updateEffortPill(sid) {
    if (!effortPill || effortPill.hidden) return;
    effortPill.textContent = effortLabel(currentEffort(sid));
    effortPill.title =
      T(
        'options.effort.title',
        '사고 수준 — 높을수록 깊이 추론하지만 느려질 수 있습니다'
      ) + draftHint(sid);
  }

  function fillEffortDropdown(box) {
    const current = effortLabel(currentEffort(activeSessionId()));
    for (const level of EFFORT_LEVELS) {
      box.appendChild(dropdownItem(effortLabel(level), current, () => selectEffort(level)));
    }
  }

  async function selectEffort(level) {
    const sid = activeSessionId();
    closeDropdown();
    if (!sid) {
      lsSet(LS_PENDING_EFFORT, level); // draft chat: applied at session creation
      updateEffortPill(null);
      return;
    }
    const prev = currentEffort(sid);
    lsSet(LS_EFFORT + sid, level); // optimistic
    updateEffortPill(sid);
    try {
      await window.kimi.setSessionEffort(sid, level);
    } catch (err) {
      console.error('setSessionEffort failed', err);
      lsSet(LS_EFFORT + sid, prev); // revert
      updateEffortPill(sid);
    }
  }

  /* ---- permission pill + dropdown (v6, both engines) ---- */

  function permissionEngine() {
    return window.App?.state?.engine === 'cli' ? 'cli' : 'direct';
  }

  function permissionModes() {
    return PERMISSION_MODES[permissionEngine()];
  }

  function currentPermission(sid) {
    // Draft chat reads the one-shot pending mode instead of a per-session key.
    const stored = sid ? lsGet(LS_PERM + sid) : lsGet(LS_PENDING_PERM);
    const modes = permissionModes();
    return modes.includes(stored) ? stored : DEFAULT_PERMISSION[permissionEngine()];
  }

  function permissionLabel(mode) {
    return T(`options.permission.${mode}`, PERMISSION_FALLBACKS[mode] || mode);
  }

  function permissionDesc(mode) {
    return T(`options.permission.${mode}_desc`, PERMISSION_DESC_FALLBACKS[mode] || '');
  }

  function updatePermissionPill(sid) {
    if (!permPill || permPill.hidden) return;
    permPill.textContent = permissionLabel(currentPermission(sid));
    permPill.title = T('options.permission.title', '권한 — 도구 실행 승인 방식') + draftHint(sid);
  }

  function fillPermissionDropdown(box) {
    const current = permissionLabel(currentPermission(activeSessionId()));
    for (const mode of permissionModes()) {
      box.appendChild(
        dropdownItem(permissionLabel(mode), current, () => selectPermission(mode), permissionDesc(mode))
      );
    }
  }

  async function selectPermission(mode) {
    const sid = activeSessionId();
    closeDropdown();
    if (!sid) {
      lsSet(LS_PENDING_PERM, mode); // draft chat: applied at session creation
      updatePermissionPill(null);
      return;
    }
    const prev = currentPermission(sid);
    lsSet(LS_PERM + sid, mode); // optimistic
    updatePermissionPill(sid);
    try {
      await window.kimi.setSessionPermission(sid, mode);
    } catch (err) {
      console.error('setSessionPermission failed', err);
      lsSet(LS_PERM + sid, prev); // revert
      updatePermissionPill(sid);
    }
  }

  /* ---- draft-state pending options (v7) ---- */

  /**
   * Apply draft-chat option picks to a freshly created session, then clear
   * them — pending values are one-shot, scoped to the next new chat. app.js
   * runs this after the Settings defaults so a pending pick wins. Each option
   * is best-effort: backend success also writes the per-session localStorage
   * key so refresh(sid) shows the applied value; failures only log. Values
   * invalid for the live engine are cleared without IPC.
   */
  async function applyPending(sessionId) {
    if (!sessionId) return;
    const pendingModel = lsGet(LS_PENDING_MODEL);
    if (pendingModel != null) {
      lsRemove(LS_PENDING_MODEL);
      try {
        if (typeof window.kimi?.setSessionModel === 'function') {
          await window.kimi.setSessionModel(sessionId, pendingModel);
          lsSet(LS_MODEL + sessionId, pendingModel);
        }
      } catch (err) {
        console.error('applyPending: setSessionModel failed', err);
      }
    }
    const pendingSwarm = lsGet(LS_PENDING_SWARM);
    if (pendingSwarm != null) {
      lsRemove(LS_PENDING_SWARM);
      try {
        if (
          (pendingSwarm === '1' || pendingSwarm === '0') &&
          typeof window.kimi?.setSessionSwarm === 'function'
        ) {
          await window.kimi.setSessionSwarm(sessionId, pendingSwarm === '1');
          lsSet(LS_SWARM + sessionId, pendingSwarm);
        }
      } catch (err) {
        console.error('applyPending: setSessionSwarm failed', err);
      }
    }
    const pendingEffort = lsGet(LS_PENDING_EFFORT);
    if (pendingEffort != null) {
      lsRemove(LS_PENDING_EFFORT);
      try {
        if (
          EFFORT_LEVELS.includes(pendingEffort) &&
          typeof window.kimi?.setSessionEffort === 'function'
        ) {
          await window.kimi.setSessionEffort(sessionId, pendingEffort);
          lsSet(LS_EFFORT + sessionId, pendingEffort);
        }
      } catch (err) {
        console.error('applyPending: setSessionEffort failed', err);
      }
    }
    const pendingPerm = lsGet(LS_PENDING_PERM);
    if (pendingPerm != null) {
      lsRemove(LS_PENDING_PERM);
      try {
        if (
          permissionModes().includes(pendingPerm) &&
          typeof window.kimi?.setSessionPermission === 'function'
        ) {
          await window.kimi.setSessionPermission(sessionId, pendingPerm);
          lsSet(LS_PERM + sessionId, pendingPerm);
        }
      } catch (err) {
        console.error('applyPending: setSessionPermission failed', err);
      }
    }
  }

  /* ---- public API ---- */

  /** Wire option pills. Idempotent; safe to call again after DOM changes. */
  function init() {
    modelPill = $('#model-select');
    swarmBtn = $('#swarm-toggle');
    effortPill = $('#effort-select');
    permPill = $('#permission-select');
    if (modelPill) {
      if (typeof window.kimi?.listModels !== 'function') {
        modelPill.hidden = true;
      } else if (!modelPill.dataset.chatOptionsWired) {
        modelPill.dataset.chatOptionsWired = '1';
        modelPill.addEventListener('click', () =>
          toggleDropdownFor(modelPill, fillModelDropdown)
        );
      }
    }
    if (swarmBtn) {
      // v4: the pill renders in both engines — inert when the preload omits
      // setSessionSwarm (direct engine), fully wired when available (cli).
      swarmBtn.hidden = false;
      if (!swarmAvailable()) {
        swarmBtn.classList.add('disabled');
        swarmBtn.setAttribute('aria-disabled', 'true');
        swarmBtn.setAttribute('aria-pressed', 'false');
        // No click listener: the disabled pill is a deliberate no-op.
      } else {
        swarmBtn.classList.remove('disabled');
        swarmBtn.removeAttribute('aria-disabled');
        if (!swarmBtn.dataset.chatOptionsWired) {
          swarmBtn.dataset.chatOptionsWired = '1';
          swarmBtn.addEventListener('click', () =>
            toggleDropdownFor(swarmBtn, fillSwarmDropdown)
          );
        }
      }
    }
    if (effortPill) {
      if (typeof window.kimi?.setSessionEffort !== 'function') {
        effortPill.hidden = true; // preload too old / engine without effort: hidden
      } else if (!effortPill.dataset.chatOptionsWired) {
        effortPill.hidden = false;
        effortPill.dataset.chatOptionsWired = '1';
        effortPill.addEventListener('click', () =>
          toggleDropdownFor(effortPill, fillEffortDropdown)
        );
      } else {
        effortPill.hidden = false; // API appeared after an earlier init
      }
    }
    if (permPill) {
      // v6: visible in BOTH engines — the preload advertises
      // setSessionPermission for direct (ask|auto) and cli (manual|auto|yolo).
      if (typeof window.kimi?.setSessionPermission !== 'function') {
        permPill.hidden = true; // preload too old: hidden
      } else if (!permPill.dataset.chatOptionsWired) {
        permPill.hidden = false;
        permPill.dataset.chatOptionsWired = '1';
        permPill.addEventListener('click', () =>
          toggleDropdownFor(permPill, fillPermissionDropdown)
        );
      } else {
        permPill.hidden = false; // API appeared after an earlier init
      }
    }
    refresh(activeSessionId());
  }

  /** Re-sync pill labels + toggle state with a (possibly new) active session. */
  function refresh(sessionId) {
    const sid = sessionId ?? activeSessionId();
    if (modelPill && !modelPill.hidden) updateModelPill(sid);
    if (swarmBtn && !swarmBtn.hidden) updateSwarm(sid);
    if (effortPill && !effortPill.hidden) updateEffortPill(sid);
    if (permPill && !permPill.hidden) updatePermissionPill(sid);
  }

  // Language change: re-apply translated pill labels/tooltips in place.
  window.I18N?.onChange?.(() => refresh(activeSessionId()));

  window.ChatOptions = { init, refresh, applyPending };
})();
