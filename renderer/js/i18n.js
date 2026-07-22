// i18n stub (wave 2A). Replaced by the full ko/en string tables in wave 2B.
// Convention: const T = (k, f) => (window.I18N?.t ? window.I18N.t(k, f) : f);
(function () {
  'use strict';
  window.I18N = {
    lang: localStorage.getItem('kimi.lang') || 'ko',
    t(key, fallback) { return fallback ?? key; },
    setLang(lang) { this.lang = lang; localStorage.setItem('kimi.lang', lang); },
  };
})();
