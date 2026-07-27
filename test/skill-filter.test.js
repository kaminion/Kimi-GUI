'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { filterSkills } = require('../renderer/js/skill-filter');

const skills = [
  {
    name: 'release-notes',
    description: 'Prepare screenshots and release copy',
    path: '/work/.agents/skills/release-notes',
    family: 'agents',
    scope: 'project',
    enabled: true,
  },
  {
    name: 'Code Review',
    description: 'Review patches for regressions',
    path: '/Users/demo/.kimi-code/skills/code-review',
    family: 'kimi',
    scope: 'user',
    enabled: false,
  },
];

test('Skill search matches name, description, path, and multiple terms', () => {
  assert.deepEqual(filterSkills(skills, 'release').map((skill) => skill.name), ['release-notes']);
  assert.deepEqual(filterSkills(skills, 'SCREENSHOTS project').map((skill) => skill.name), ['release-notes']);
  assert.deepEqual(filterSkills(skills, '.kimi-code disabled').map((skill) => skill.name), ['Code Review']);
  assert.deepEqual(filterSkills(skills, '없는 스킬'), []);
});

test('empty Skill search preserves the original ordered list', () => {
  assert.equal(filterSkills(skills, ''), skills);
  assert.equal(filterSkills(skills, '   '), skills);
});
