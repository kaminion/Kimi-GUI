/* i18n.js — ko/en string tables and the window.I18N global.
 *
 * Convention (all renderer modules):
 *   const T = (k, f) => (window.I18N?.t ? window.I18N.t(k, f) : f);
 *   T('snake_case.key', 'Korean fallback')  -> table lookup, else fallback.
 * Dynamic values stay outside T() and concatenate, so both languages read
 * naturally (e.g. m + T('panel.time_min', '분 전')).
 *
 * Static markup (index.html) carries English default text plus
 * data-i18n / data-i18n-placeholder / data-i18n-title / data-i18n-aria
 * attributes; I18N.applyToDom(root) translates those in place. It runs once
 * on DOMContentLoaded and again on every language change.
 *
 * Language persists in localStorage 'kimi.lang' (default 'ko'). setLang
 * re-stamps <html lang>, re-applies data-i18n attributes, then notifies
 * listeners registered via I18N.onChange (window event 'kimi:lang').
 */
(function () {
  'use strict';

  const LS_KEY = 'kimi.lang';

  /* Korean: exactly the fallback strings used at the T() call sites.
   * English: concise Apple-style UI copy. */
  const TABLE = {
    ko: {
      'app.boot_error_hint': 'Kimi Code CLI가 설치되어 있는지 확인한 뒤 다시 시도하세요.',
      'app.boot_error_title': 'Kimi를 시작할 수 없습니다',
      'app.boot_retry': '다시 시도',
      'app.error.cli_or_login': 'Kimi Code CLI를 찾을 수 없거나 로그인이 필요합니다.',
      'app.error.cli_or_server': 'Kimi Code CLI를 찾을 수 없거나 로컬 서버를 시작하지 못했습니다.',
      'app.error.no_preload': 'preload API(window.kimi)를 사용할 수 없습니다.',
      'app.server_connected': '서버 연결됨',
      'app.server_disconnected': '서버 연결 끊김',
      'app.server_status_aria': '서버 상태',
      'app.unknown_error': '알 수 없는 오류가 발생했습니다.',
      'approval.approve': '승인',
      'approval.confirm': '확인',
      'approval.hint': '에이전트가 다음 작업을 실행하려고 합니다.',
      'approval.no_args': '(인자 없음)',
      'approval.other': '기타',
      'approval.question_title': '질문',
      'approval.recommended': '권장',
      'approval.reject': '거절',
      'approval.skip': '건너뛰기',
      'approval.title': '도구 승인 요청',
      'chat.abort': '중단',
      'chat.attachment.file': '첨부 파일',
      'chat.attachment.image': '첨부 이미지',
      'chat.composer_aria': '메시지 입력',
      'chat.composer_placeholder': '메시지를 입력하세요…',
      'chat.context_title_pre': '컨텍스트 ',
      'chat.empty_state': '무엇을 도와드릴까요?',
      'chat.new_chat': '새 대화',
      'chat.send_aria': '전송',
      'chat.send_failed': '메시지 전송에 실패했어요. 다시 시도해 주세요.',
      'chat.send_title': '전송 (↵)',
      'chat.thinking': '사고 과정',
      'chat.tool.no_content': '(내용 없음)',
      'common.loading': '불러오는 중…',
      'common.tokens': ' 토큰',
      'markdown.copied': '복사됨',
      'markdown.copy': '복사',
      'onboarding.cancel': '취소',
      'onboarding.cli_desc': 'Kimi Code CLI를 자동으로 설치합니다.',
      'onboarding.cli_error': '자동 설치에 실패했습니다. 수동 설치 안내를 확인해 주세요.',
      'onboarding.cli_error_title': '설치에 실패했습니다',
      'onboarding.cli_install': '설치 시작',
      'onboarding.cli_installed': '설치가 완료되었습니다',
      'onboarding.cli_installing': '설치 중…',
      'onboarding.cli_title': 'Kimi Code CLI가 필요합니다',
      'onboarding.cli_verify_failed': '설치를 확인할 수 없습니다. 다시 시도해 주세요.',
      'onboarding.copied': '복사되었습니다',
      'onboarding.copy_failed': '복사에 실패했습니다',
      'onboarding.copy_hint': '클릭하여 복사',
      'onboarding.login_desc': '브라우저에서 인증 코드를 입력해 로그인합니다',
      'onboarding.login_done': '로그인 완료',
      'onboarding.login_done_desc': '잠시 후 시작합니다.',
      'onboarding.login_error': '로그인에 실패했습니다. 다시 시도해 주세요.',
      'onboarding.login_open': '인증 페이지 열기',
      'onboarding.login_start': '로그인 시작',
      'onboarding.login_title': 'Kimi 로그인',
      'onboarding.login_waiting': '대기 중…',
      'onboarding.manual_install': '수동 설치 안내',
      'onboarding.preparing': '준비 중…',
      'onboarding.retry': '다시 시도',
      'options.model.empty': '사용 가능한 모델이 없습니다',
      'options.model.loading': '불러오는 중…',
      'options.model.none': '모델',
      'options.model.pick': '모델 선택',
      'options.swarm.label': '스웜',
      'options.swarm.off': '스웜 모드 꺼짐',
      'options.swarm.on': '스웜 모드 켜짐',
      'panel.close': '패널 닫기',
      'panel.empty': '실행 중인 작업이 없습니다',
      'panel.section_activity': '최근 도구 활동',
      'panel.section_files': '변경된 파일',
      'panel.section_tasks': '작업',
      'panel.status_idle': '대기',
      'panel.status_label': '현재 상태',
      'panel.status_running': '실행 중',
      'panel.time_day': '일 전',
      'panel.time_hour': '시간 전',
      'panel.time_min': '분 전',
      'panel.time_now': '방금',
      'panel.title': '에이전트 작업',
      'panel.toggle': '작업 패널',
      'search.empty': '검색 결과가 없습니다',
      'search.error': '검색 중 오류가 발생했습니다',
      'search.open_aria': '검색',
      'search.open_title': '검색 (⌘F)',
      'search.placeholder': '대화 내용 검색…',
      'search.role.assistant': '어시스턴트',
      'search.role.system': '시스템',
      'search.role.tool': '도구',
      'search.role.user': '사용자',
      'search.time.days_ago': '일 전',
      'search.time.hours_ago': '시간 전',
      'search.time.just_now': '방금 전',
      'search.time.minutes_ago': '분 전',
      'search.title': '대화 검색',
      'search.unavailable': '검색을 사용할 수 없습니다',
      'search.untitled': '제목 없음',
      'settings.account.cancel_login': '취소',
      'settings.account.checking': '확인 중…',
      'settings.account.console': 'Kimi Code Console 열기',
      'settings.account.logged_in': '로그인됨',
      'settings.account.login_failed': '로그인에 실패했습니다',
      'settings.account.login_hint': '브라우저가 열리면 아래 코드를 입력하세요.',
      'settings.account.login_required': '로그인 필요',
      'settings.account.login_unavailable': '로그인 기능을 사용할 수 없습니다',
      'settings.account.open_browser': '브라우저에서 인증',
      'settings.account.preparing': '로그인 준비 중…',
      'settings.account.relogin': '다시 로그인',
      'settings.account.status': '로그인 상태',
      'settings.account.unknown': '확인할 수 없음',
      'settings.account.waiting': '인증 대기 중…',
      'settings.general.lang.en': 'English',
      'settings.general.lang.ko': '한국어',
      'settings.general.language': '언어',
      'settings.general.theme': '테마',
      'settings.general.theme.dark': '다크',
      'settings.general.theme.light': '라이트',
      'settings.general.theme.system': '시스템',
      'settings.info.cli_path': 'CLI 경로',
      'settings.info.cli_version': 'CLI 버전',
      'settings.info.not_found': '찾을 수 없음',
      'settings.info.server_version': '서버 버전',
      'settings.model.default': '기본 모델',
      'settings.model.desc': '새 대화에 적용되는 모델입니다.',
      'settings.model.empty': '사용 가능한 모델이 없습니다',
      'settings.model.load_failed': '모델 목록을 불러오지 못했습니다',
      'settings.model.loading': '불러오는 중…',
      'settings.model.unavailable': '모델 목록을 사용할 수 없습니다',
      'settings.open_title': '설정',
      'settings.section.account': '계정',
      'settings.section.general': '일반',
      'settings.section.info': '정보',
      'settings.section.model': '모델',
      'settings.section.updates': '업데이트',
      'settings.title': '설정',
      'settings.update.check': '업데이트 확인',
      'settings.update.current_version': '현재 버전',
      'settings.update.restart': '재시작 및 설치',
      'settings.update.row_label': '앱 업데이트',
      'settings.update.status.checking': '확인 중…',
      'settings.update.status.dev': '개발 빌드입니다',
      'settings.update.status.downloaded': '새 버전',
      'settings.update.status.downloaded_suffix': ' 설치 준비 완료',
      'settings.update.status.downloaded_unknown': '설치 준비 완료',
      'settings.update.status.downloading': '새 버전',
      'settings.update.status.downloading_suffix': ' 다운로드 중…',
      'settings.update.status.downloading_unknown': '새 버전 다운로드 중…',
      'settings.update.status.error': '업데이트 확인에 실패했습니다',
      'settings.update.status.none': '최신입니다',
      'sidebar.group_other': '기타',
      'sidebar.group_toggle': '접기/펼치기',
      'sidebar.list_aria': '대화 목록',
      'sidebar.new_chat_title': '새 대화 (⌘N)',
      'sidebar.time.day_suffix': '일',
      'sidebar.time.days_ago': '일 전',
      'sidebar.time.hours_ago': '시간 전',
      'sidebar.time.just_now': '방금 전',
      'sidebar.time.minutes_ago': '분 전',
      'sidebar.time.month_sep': '월 ',
      'update.ready_title': '업데이트 준비됨 — 설정에서 다시 시작하여 적용',
      'usage.account_quota': '계정 할당량',
      'usage.cache_creation_tokens': '캐시 생성 토큰',
      'usage.cache_read_tokens': '캐시 읽기 토큰',
      'usage.context_window': '컨텍스트 윈도우',
      'usage.current_session': '현재 세션',
      'usage.extra_balance': '추가 잔액',
      'usage.input_tokens': '입력 토큰',
      'usage.load_failed': '사용량 정보를 불러올 수 없습니다.',
      'usage.nav': '사용량',
      'usage.nav_title': '사용량 (⌘,)',
      'usage.no_session': '선택된 세션이 없습니다. 대화를 시작하면 이곳에 사용량이 표시됩니다.',
      'usage.open': '열기',
      'usage.output_tokens': '출력 토큰',
      'usage.percent_used': '% 사용',
      'usage.quota_console_hint': 'Kimi Code Console에서 확인할 수 있습니다',
      'usage.resets': '재설정: ',
      'usage.total_cost': '총 비용',
      'usage.turns': '턴 수',
      'usage.weekly': '주간 사용량',
      'usage.window_5h': '5시간 윈도우',
    },
    en: {
      'app.boot_error_hint': 'Make sure Kimi Code CLI is installed, then try again.',
      'app.boot_error_title': 'Kimi Couldn’t Start',
      'app.boot_retry': 'Try Again',
      'app.error.cli_or_login': 'Kimi Code CLI was not found, or login is required.',
      'app.error.cli_or_server': 'Kimi Code CLI was not found, or the local server failed to start.',
      'app.error.no_preload': 'The preload API (window.kimi) is unavailable.',
      'app.server_connected': 'Server connected',
      'app.server_disconnected': 'Server disconnected',
      'app.server_status_aria': 'Server status',
      'app.unknown_error': 'An unknown error occurred.',
      'approval.approve': 'Approve',
      'approval.confirm': 'OK',
      'approval.hint': 'The agent wants to perform the following action.',
      'approval.no_args': '(no arguments)',
      'approval.other': 'Other',
      'approval.question_title': 'Question',
      'approval.recommended': 'Recommended',
      'approval.reject': 'Reject',
      'approval.skip': 'Skip',
      'approval.title': 'Tool Approval Request',
      'chat.abort': 'Stop',
      'chat.attachment.file': 'Attachment',
      'chat.attachment.image': 'Attached image',
      'chat.composer_aria': 'Message input',
      'chat.composer_placeholder': 'Type a message…',
      'chat.context_title_pre': 'Context ',
      'chat.empty_state': 'How can I help?',
      'chat.new_chat': 'New Chat',
      'chat.send_aria': 'Send',
      'chat.send_failed': 'Failed to send the message. Please try again.',
      'chat.send_title': 'Send (↵)',
      'chat.thinking': 'Thinking',
      'chat.tool.no_content': '(no content)',
      'common.loading': 'Loading…',
      'common.tokens': ' tokens',
      'markdown.copied': 'Copied',
      'markdown.copy': 'Copy',
      'onboarding.cancel': 'Cancel',
      'onboarding.cli_desc': 'Kimi Code CLI will be installed automatically.',
      'onboarding.cli_error': 'Automatic installation failed. Please see the manual install guide.',
      'onboarding.cli_error_title': 'Installation Failed',
      'onboarding.cli_install': 'Install',
      'onboarding.cli_installed': 'Installation complete',
      'onboarding.cli_installing': 'Installing…',
      'onboarding.cli_title': 'Kimi Code CLI Required',
      'onboarding.cli_verify_failed': 'Couldn’t verify the installation. Please try again.',
      'onboarding.copied': 'Copied',
      'onboarding.copy_failed': 'Copy failed',
      'onboarding.copy_hint': 'Click to copy',
      'onboarding.login_desc': 'Enter the verification code in your browser to log in',
      'onboarding.login_done': 'Logged In',
      'onboarding.login_done_desc': 'Starting in a moment.',
      'onboarding.login_error': 'Login failed. Please try again.',
      'onboarding.login_open': 'Open Verification Page',
      'onboarding.login_start': 'Log In',
      'onboarding.login_title': 'Log In to Kimi',
      'onboarding.login_waiting': 'Waiting…',
      'onboarding.manual_install': 'Manual Install Guide',
      'onboarding.preparing': 'Preparing…',
      'onboarding.retry': 'Try Again',
      'options.model.empty': 'No models available',
      'options.model.loading': 'Loading…',
      'options.model.none': 'Model',
      'options.model.pick': 'Select Model',
      'options.swarm.label': 'Swarm',
      'options.swarm.off': 'Swarm mode off',
      'options.swarm.on': 'Swarm mode on',
      'panel.close': 'Close Panel',
      'panel.empty': 'No active tasks',
      'panel.section_activity': 'Recent Tool Activity',
      'panel.section_files': 'Changed Files',
      'panel.section_tasks': 'Tasks',
      'panel.status_idle': 'Idle',
      'panel.status_label': 'Status',
      'panel.status_running': 'Running',
      'panel.time_day': 'd ago',
      'panel.time_hour': 'h ago',
      'panel.time_min': 'm ago',
      'panel.time_now': 'now',
      'panel.title': 'Agent Activity',
      'panel.toggle': 'Agent Panel',
      'search.empty': 'No Results',
      'search.error': 'Something went wrong while searching',
      'search.open_aria': 'Search',
      'search.open_title': 'Search (⌘F)',
      'search.placeholder': 'Search conversations…',
      'search.role.assistant': 'Assistant',
      'search.role.system': 'System',
      'search.role.tool': 'Tool',
      'search.role.user': 'User',
      'search.time.days_ago': 'd ago',
      'search.time.hours_ago': 'h ago',
      'search.time.just_now': 'Just now',
      'search.time.minutes_ago': 'm ago',
      'search.title': 'Search Conversations',
      'search.unavailable': 'Search unavailable',
      'search.untitled': 'Untitled',
      'settings.account.cancel_login': 'Cancel',
      'settings.account.checking': 'Checking…',
      'settings.account.console': 'Open Kimi Code Console',
      'settings.account.logged_in': 'Logged in',
      'settings.account.login_failed': 'Login failed',
      'settings.account.login_hint': 'Enter this code in the browser window that opens.',
      'settings.account.login_required': 'Login required',
      'settings.account.login_unavailable': 'Login is unavailable',
      'settings.account.open_browser': 'Verify in Browser',
      'settings.account.preparing': 'Preparing login…',
      'settings.account.relogin': 'Log In Again',
      'settings.account.status': 'Login Status',
      'settings.account.unknown': 'Unknown',
      'settings.account.waiting': 'Waiting for verification…',
      'settings.general.lang.en': 'English',
      'settings.general.lang.ko': '한국어', // endonym, Apple language-menu style
      'settings.general.language': 'Language',
      'settings.general.theme': 'Theme',
      'settings.general.theme.dark': 'Dark',
      'settings.general.theme.light': 'Light',
      'settings.general.theme.system': 'System',
      'settings.info.cli_path': 'CLI Path',
      'settings.info.cli_version': 'CLI Version',
      'settings.info.not_found': 'Not found',
      'settings.info.server_version': 'Server Version',
      'settings.model.default': 'Default Model',
      'settings.model.desc': 'Applied to new chats.',
      'settings.model.empty': 'No models available',
      'settings.model.load_failed': 'Couldn’t load the model list',
      'settings.model.loading': 'Loading…',
      'settings.model.unavailable': 'Model list unavailable',
      'settings.open_title': 'Settings',
      'settings.section.account': 'Account',
      'settings.section.general': 'General',
      'settings.section.info': 'About',
      'settings.section.model': 'Model',
      'settings.section.updates': 'Updates',
      'settings.title': 'Settings',
      'settings.update.check': 'Check for Updates',
      'settings.update.current_version': 'Current Version',
      'settings.update.restart': 'Restart and Install',
      'settings.update.row_label': 'App Update',
      'settings.update.status.checking': 'Checking…',
      'settings.update.status.dev': 'Development build',
      'settings.update.status.downloaded': 'Update',
      'settings.update.status.downloaded_suffix': ' ready to install',
      'settings.update.status.downloaded_unknown': 'Ready to install',
      'settings.update.status.downloading': 'Downloading update',
      'settings.update.status.downloading_suffix': '…',
      'settings.update.status.downloading_unknown': 'Downloading update…',
      'settings.update.status.error': 'Update check failed',
      'settings.update.status.none': 'You’re up to date',
      'sidebar.group_other': 'Other',
      'sidebar.group_toggle': 'Collapse/Expand',
      'sidebar.list_aria': 'Conversations',
      'sidebar.new_chat_title': 'New Chat (⌘N)',
      'sidebar.time.day_suffix': '',
      'sidebar.time.days_ago': 'd ago',
      'sidebar.time.hours_ago': 'h ago',
      'sidebar.time.just_now': 'Just now',
      'sidebar.time.minutes_ago': 'm ago',
      'sidebar.time.month_sep': '/',
      'update.ready_title': 'Update ready — restart from Settings to apply',
      'usage.account_quota': 'Account Quota',
      'usage.cache_creation_tokens': 'Cache Write Tokens',
      'usage.cache_read_tokens': 'Cache Read Tokens',
      'usage.context_window': 'Context Window',
      'usage.current_session': 'Current Session',
      'usage.extra_balance': 'Extra Balance',
      'usage.input_tokens': 'Input Tokens',
      'usage.load_failed': 'Usage information is unavailable.',
      'usage.nav': 'Usage',
      'usage.nav_title': 'Usage (⌘,)',
      'usage.no_session': 'No session selected. Start a chat to see its usage here.',
      'usage.open': 'Open',
      'usage.output_tokens': 'Output Tokens',
      'usage.percent_used': '% used',
      'usage.quota_console_hint': 'View usage in Kimi Code Console',
      'usage.resets': 'Resets: ',
      'usage.total_cost': 'Total Cost',
      'usage.turns': 'Turns',
      'usage.weekly': 'Weekly Usage',
      'usage.window_5h': '5-Hour Window',
    },
  };

  function readStoredLang() {
    try {
      const v = localStorage.getItem(LS_KEY);
      if (v && TABLE[v]) return v;
    } catch (_) { /* private mode */ }
    return 'ko';
  }

  // Module re-render hooks, fanned out from the single 'kimi:lang' listener
  // below (registered first, so data-i18n attributes update before modules).
  const changeListeners = new Set();

  function applyToDom(root) {
    root = root || document;
    if (!root || typeof root.querySelectorAll !== 'function') return;
    const t = (key, current) => I18N.t(key, current ?? undefined);
    root.querySelectorAll('[data-i18n]').forEach((n) => {
      n.textContent = t(n.getAttribute('data-i18n'), n.textContent);
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach((n) => {
      n.setAttribute('placeholder', t(n.getAttribute('data-i18n-placeholder'), n.getAttribute('placeholder')));
    });
    root.querySelectorAll('[data-i18n-title]').forEach((n) => {
      n.setAttribute('title', t(n.getAttribute('data-i18n-title'), n.getAttribute('title')));
    });
    root.querySelectorAll('[data-i18n-aria]').forEach((n) => {
      n.setAttribute('aria-label', t(n.getAttribute('data-i18n-aria'), n.getAttribute('aria-label')));
    });
  }

  const I18N = {
    lang: readStoredLang(),
    tables: TABLE, // exposed for tests/debugging; treat as read-only
    t(key, fallback) {
      const table = TABLE[this.lang] || TABLE.ko;
      const v = table ? table[key] : undefined;
      return v != null ? v : (fallback ?? key);
    },
    setLang(lang) {
      if (!TABLE[lang]) return;
      try { localStorage.setItem(LS_KEY, lang); } catch (_) { /* private mode */ }
      if (this.lang === lang) return;
      this.lang = lang;
      document.documentElement.lang = lang;
      window.dispatchEvent(new CustomEvent('kimi:lang', { detail: { lang } }));
    },
    onChange(cb) {
      if (typeof cb !== 'function') return () => {};
      changeListeners.add(cb);
      return () => changeListeners.delete(cb);
    },
    applyToDom,
  };
  window.I18N = I18N;

  window.addEventListener('kimi:lang', () => {
    applyToDom(document);
    for (const cb of changeListeners) {
      try { cb(I18N.lang); } catch (err) { console.error('i18n onChange listener failed', err); }
    }
  });

  // Boot: stamp <html lang> immediately; translate static markup once the
  // DOM is usable (script order puts this listener ahead of other modules).
  document.documentElement.lang = I18N.lang;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => applyToDom(document));
  } else {
    applyToDom(document);
  }
})();
