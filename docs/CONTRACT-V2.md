# CONTRACT V2 (binding, additive to ARCHITECTURE.md)

Wave-2 features: splash/onboarding (CLI auto-install + login), content search + session grouping,
i18n (ko/en), right agent-work panel, chat options (model/swarm), settings, black-premium theme,
auto-update. V1 contract stays valid except where this file overrides.

## File ownership (wave 2)

```
main/main.js, main/ipc.js, main/preload.js, main/onboarding.js, main/kimi-client.js (ADDITIVE only) -> M1 main-wiring
main/search.js                                                       -> M2 search-backend
main/updater.js, package.json, docs/update.md                        -> M3 updater
renderer/js/onboarding.js, renderer/styles/onboarding.css            -> R1 onboarding-ui
renderer/js/search.js, renderer/js/chat.js (ADDITIVE method only)    -> R2 search-ui
renderer/js/panel.js, renderer/styles/panel.css                      -> R3 panel
renderer/js/settings.js, renderer/js/chat-options.js, renderer/styles/settings.css -> R4 settings
renderer/styles/base.css, layout.css, components.css                 -> R5 theme
renderer/index.html, renderer/js/app.js, renderer/js/sidebar.js      -> R6 shell
```

## New preload API (window.kimi additions — M1 implements, lazy-requires ./search, ./updater, ./onboarding with try/catch so missing modules degrade to thrown Error, never crash)

```
onboardingGetState() -> { cliInstalled, cliPath?, cliVersion?, loggedIn, needsOnboarding }
onboardingInstallCli() -> { ok, cliPath? }        // progress via push events
onboardingStartLogin() -> { verificationUrl, userCode }   // completion via push events
onboardingCancelLogin() -> { ok }
listModels() -> [ { alias, model } ]              // from GET /api/v1/models (verify shape!)
setSessionModel(sessionId, modelAlias)            // POST /sessions/{id}/profile {agent_config:{model}}
setSessionSwarm(sessionId, enabled)               // ONLY if an endpoint is discovered; else omit + report
listTasks(sessionId)                              // GET /sessions/{id}/tasks
searchAll(query, limit=50) -> [ { sessionId, sessionTitle, cwd, messageId, role, snippet, createdAt } ]
updateCheck() -> { status:'dev'|'checking'|'available'|'downloading'|'downloaded'|'none'|'error', version?, message? }
updateQuitAndInstall()
getAppVersion() -> string
```
Push events (same 'kimi:event' channel): `{type:'onboarding', phase:'install'|'login', percent?, message?, status?}`,
`{type:'update', status, version?, message?}`.

## DOM v2 (R6 adds to index.html; ids fixed)

```html
<div id="splash"><div id="splash-logo"></div><div id="splash-word">Kimi</div></div>
<div id="onboarding" hidden>
  <div id="onboarding-card">
    <div id="onboarding-logo"></div>
    <h1 id="onboarding-title"></h1><p id="onboarding-desc"></p>
    <div id="onboarding-progress" hidden><div class="progress-bar"><div></div></div><span id="onboarding-progress-label"></span></div>
    <div id="onboarding-login" hidden><code id="login-code"></code><button id="login-url-btn"></button><span id="login-status"></span></div>
    <div id="onboarding-actions"><button id="onboarding-primary-btn" class="btn btn-primary"></button><button id="onboarding-secondary-btn" class="btn btn-ghost"></button></div>
  </div>
</div>
<!-- inside #sidebar-header: + <button id="search-open-btn"> ; inside #sidebar-footer: + <button id="settings-btn"> -->
<!-- inside #chat-header (before #abort-btn): + <button id="model-select" class="pill"></button><button id="swarm-toggle" class="pill" hidden></button><button id="panel-toggle-btn"></button> -->
<!-- after </main>, inside #app: -->
<aside id="panel" hidden>
  <div id="panel-header"><span id="panel-title"></span><button id="panel-close-btn"></button></div>
  <div id="panel-content"><div id="panel-status"></div><div id="panel-tasks"></div><div id="panel-activity"></div><div id="panel-files"></div></div>
</aside>
<!-- before #modal-root: -->
<div id="search-palette" hidden><input id="search-input" type="search"/><div id="search-results"></div></div>
<div id="settings-root"></div>
```
Script order: vendor/marked.min.js, vendor/highlight.min.js, js/i18n.js (stub exists, replaced later),
js/markdown.js, js/chat.js, js/approvals.js, js/onboarding.js, js/search.js, js/panel.js,
js/settings.js, js/chat-options.js, js/sidebar.js, js/usage.js, js/app.js (last).
CSS order: base, layout, components, onboarding, panel, settings.

## Feature specs

### Onboarding (M1 + R1)
- `loggedIn` = `~/.kimi-code/credentials/kimi-code.json` exists with non-empty `access_token` (honor KIMI_CODE_HOME).
- `needsOnboarding` = `!cliInstalled || !loggedIn`. Splash plays on EVERY launch (logo fade/scale-in ~600ms,
  hold 300ms, then whole layer slides down & fades, cubic-bezier(0.22,1,0.36,1); respect prefers-reduced-motion),
  then route: needsOnboarding → #onboarding, else → #app.
- CLI install (M1): discover official install method (fetch https://code.kimi.com/install.sh, read it; Windows:
  research the documented native install path). Run it with progress events; after install re-resolve binary
  (~/.kimi-code/bin). Never require sudo. If undiscoverable → actionable error with manual-install link.
- Login (M1): spawn `kimi login`, parse verification URL + user code from stderr (regex), resolve
  onboardingStartLogin with both; keep polling child exit → push {phase:'login', status:'done'|'error'}.
  onboardingCancelLogin kills the child. R1 renders code large-mono + '브라우저에서 인증' button (openExternal).
- Settings must be able to re-run login later (R4 calls the same APIs).

### Search (M2 + R2)
- M2: sessions live under ~/.kimi-code/sessions/<wd_*>/<session_id>/ — DISCOVER the transcript/wire JSONL format
  yourself. Extract user+assistant text, mtime-cached incremental index, case-insensitive substring match,
  ranked by recency, snippet = match ±40 chars. Return shape per preload contract. Honor KIMI_CODE_HOME.
- R2: ⌘F / #search-open-btn toggles #search-palette (Spotlight-style, centered top, backdrop blur);
  debounce 200ms → searchAll; results grouped by session title; Enter/click →
  `App.openSessionAtMessage(sessionId, messageId)` (R6 implements: selectSession then Chat.scrollToMessage).
- R2's chat.js ADDITIVE edit ONLY: every rendered message row gets `data-message-id`, plus
  `Chat.scrollToMessage(id)` (scrollIntoView + 1.2s highlight flash). Do not refactor chat.js.

### Session grouping (R6)
- Sidebar groups sessions by PROJECT (cwd basename), collapsible chevron groups, sorted by latest activity;
  collapsed state persisted in localStorage. Item shows title + relative time. Fall back to flat list if cwd missing.

### Chat options (R4) vs Settings (R4)
- Chat header: #model-select pill → dropdown from listModels(), per-session override via setSessionModel,
  label = current model alias; #swarm-toggle shown ONLY if M1 discovered a swarm endpoint (else stays hidden).
- Settings modal (#settings-root): sections 일반(언어: 한국어/English → localStorage 'kimi.lang' + window.I18N?.setLang?.();
  테마: 시스템/다크/라이트 → documentElement.dataset.theme + localStorage 'kimi.theme'), 모델(기본 모델 select,
  localStorage 'kimi.defaultModel', applied right after createSession), 계정(로그인 상태 표시, '다시 로그인' →
  onboarding login APIs, 'Kimi Code Console 열기' → https://www.kimi.com/code/console), 업데이트(현재 버전
  getAppVersion, '업데이트 확인' → updateCheck, 상태 텍스트), 정보(CLI 경로/버전, 서버 버전 from getState).
- All copy via `T(key, fallback)` helper convention: `const T = (k,f)=> (window.I18N?.t ? window.I18N.t(k,f) : f);`
  (i18n tables land in wave 2B — wrap every NEW user-visible string; keys snake_case like 'settings.title').

### Right panel (R3)
- Data: window.kimi.listTasks(activeSession) on select + poll 5s while busy; live events from App dispatch
  (R6 forwards all session events to Panel.handleEvent(sessionId, ev)); discover task/tool/work event shapes from
  docs/protocol.md + grep docs/ref/webui-bundle.js for 'task.' / 'work_changed' / 'tool.'.
- Sections: 현재 실행 상태 (idle/running + active tool), 작업 (task list w/ status glyph), 최근 도구 활동
  (last 30, mono name + summary + status dot), 변경된 파일 (paths from work events). Width 300px, pushes content
  (not overlay), open state persisted, hidden-by-default. Empty state copy when no active run.

### Theme (R5) — black premium
- Rework tokens to `:root` (light values) + `:root[data-theme="dark"]` + default-when-unset = DARK via
  `@media (prefers-color-scheme: dark)` AND `:root:not([data-theme="light"])` fallback (app is dark-first).
- Dark palette: --bg #000000, --bg-secondary #0A0A0D, --sidebar-bg rgba(14,14,18,.72) (+backdrop blur),
  --text #F5F5F7, --text-secondary #98989F, --text-dim #6E6E73, --border rgba(255,255,255,.08),
  --accent #0A84FF, --code-bg #101013, hairline borders, NO gradients, subtle shadows only.
- Premium = restraint: 8pt grid, 13px chrome / 14px content (unchanged), generous whitespace, SF stack.
- Light theme keeps v1 Apple light values. boot: app.js (R6) applies dataset.theme from localStorage before first paint
  (inline <script> in <head> of index.html to avoid FOUC).

### Auto-update (M3)
- electron-updater dep + package.json `publish` placeholder (github provider, owner/repo TODO comments impossible
  in JSON → document in docs/update.md). updater.js: exports `register({ ipcMain, send })` wiring
  'kimi:updateCheck'/'kimi:updateQuitAndInstall'; in dev or unconfigured → status 'dev' (graceful, no crash);
  when packaged: autoUpdater events → send({type:'update',...}); silent check on launch + manual via settings.

## Rules
- Classic script-tag IIFEs (no imports), window globals per v1; defensive coding; Korean copy via T() helper.
- node --check every JS file you ship. Report deviations + anything integration must know.
