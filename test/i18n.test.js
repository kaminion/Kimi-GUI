'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

function loadI18n() {
  const window = {
    addEventListener() {},
    dispatchEvent() {},
  };
  const document = {
    documentElement: {},
    readyState: 'loading',
    addEventListener() {},
    querySelectorAll() { return []; },
  };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'renderer', 'js', 'i18n.js'),
    'utf8',
  );
  vm.runInNewContext(source, {
    window,
    document,
    localStorage: { getItem: () => null, setItem() {} },
    CustomEvent: class CustomEvent {},
    Set,
  });
  return window.I18N;
}

test('change-count copy provides singular and plural forms in both languages', () => {
  const i18n = loadI18n();

  i18n.lang = 'en';
  assert.equal(i18n.t('changes.file_changed'), '1 file changed');
  assert.equal(i18n.t('changes.files_changed').replace('N', '2'), '2 files changed');

  i18n.lang = 'ko';
  assert.equal(i18n.t('changes.file_changed'), '파일 1개 변경됨');
  assert.equal(i18n.t('changes.files_changed').replace('N', '2'), '파일 2개 변경됨');
});

test('launch and conversation loading states are localized', () => {
  const i18n = loadI18n();

  i18n.lang = 'en';
  assert.equal(i18n.t('app.loading_workspace'), 'Preparing your workspace…');
  assert.equal(i18n.t('chat.loading_history'), 'Loading conversation history…');
  assert.equal(i18n.t('sidebar.loading'), 'Loading conversations…');

  i18n.lang = 'ko';
  assert.equal(i18n.t('app.loading_workspace'), '작업 공간을 준비하는 중…');
  assert.equal(i18n.t('chat.loading_history'), '대화 기록을 불러오는 중…');
  assert.equal(i18n.t('sidebar.loading'), '대화 목록을 불러오는 중…');
});
