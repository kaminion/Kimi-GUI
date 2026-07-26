'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Skills has a first-class main navigation entry and focused manager', () => {
  const html = read('renderer/index.html');
  const app = read('renderer/js/app.js');
  const settings = read('renderer/js/settings.js');

  assert.ok(html.indexOf('id="skills-btn"') < html.indexOf('id="settings-btn"'));
  assert.match(app, /window\.Settings\?\.openSkills\?\.\(\)/);
  assert.match(settings, /function openSkills\(\)/);
  assert.match(settings, /open\('skills', \{ focused: true \}\)/);
  assert.doesNotMatch(
    settings.slice(settings.indexOf('function sections()'), settings.indexOf('function buildRow')),
    /\{ id: 'skills'/,
  );
});

test('Ask Kimi starts a new chat with a scope-aware Skill template', () => {
  const app = read('renderer/js/app.js');
  const chat = read('renderer/js/chat.js');
  const settings = read('renderer/js/settings.js');
  const i18n = read('renderer/js/i18n.js');

  assert.match(settings, /window\.App\?\.startSkillDraft\?\.\(selectedScope\)/);
  assert.match(app, /startSkillDraft\(scope = 'project'\)/);
  assert.match(app, /App\.startNewChat\(\)/);
  assert.match(app, /window\.Chat\?\.setComposerText\?\.\(template\)/);
  assert.match(chat, /function setComposerText\(text/);
  assert.match(i18n, /settings\.skills\.scope_user': '모든 프로젝트'/);
  assert.match(i18n, /settings\.skills\.scope_project': '현재 프로젝트'/);
  // Templates must point at directories the Kimi CLI actually discovers.
  assert.match(i18n, /\.agents\/skills\/<skill-name>\/SKILL\.md/);
  assert.match(i18n, /~\/\.kimi-code\/skills\/<skill-name>\/SKILL\.md/);
  assert.doesNotMatch(i18n, /\.config\/agents\/skills/);
  assert.doesNotMatch(app, /\.config\/agents\/skills/);
});

test('Each Skill row shows an explicit enabled/disabled state badge', () => {
  const settings = read('renderer/js/settings.js');
  const css = read('renderer/styles/settings.css');
  const i18n = read('renderer/js/i18n.js');

  assert.match(settings, /skill-badge skill-state\$\{skill\.enabled \? ' on' : ''\}/);
  assert.match(settings, /row\.classList\.toggle\('disabled', !skill\.enabled\)/);
  assert.match(css, /\.skill-state\.on \{/);
  assert.match(css, /\.skill-row\.disabled \.skill-main \{/);
  assert.match(i18n, /'settings\.skills\.enabled': '활성'/);
  assert.match(i18n, /'settings\.skills\.disabled': '비활성'/);
});
