'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { SkillManager, parseSkillText } = require('../main/skill-manager');

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-gui-skills-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function makeSkill(root, name, description = 'A test skill') {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
  );
  return dir;
}

test('skill metadata follows frontmatter with a body fallback', () => {
  assert.deepEqual(parseSkillText(
    '---\nname: review\ndescription: Review changes\ntype: flow\n---\nBody',
    'fallback',
  ), {
    name: 'review',
    description: 'Review changes',
    type: 'flow',
  });
  assert.equal(parseSkillText('# Helpful skill\n\nDetails', 'fallback').description, 'Helpful skill');
});

test('installs, disables, and re-enables a user skill without overwriting', async (t) => {
  const root = tempRoot(t);
  const home = path.join(root, 'home');
  const source = makeSkill(path.join(root, 'sources'), 'code-review', 'Review a patch');
  const manager = new SkillManager({ homeDir: home, trashItem: async () => {} });

  const installed = await manager.install({
    sourcePath: source,
    kind: 'directory',
    scope: 'user',
  });
  assert.equal(installed.name, 'code-review');
  assert.equal(installed.enabled, true);
  assert.match(installed.path, /[.]config[/\\]agents[/\\]skills[/\\]code-review$/);

  const disabled = await manager.setEnabled({ id: installed.id, enabled: false });
  assert.equal(disabled.enabled, false);
  assert.match(disabled.path, /skills-disabled[/\\]code-review$/);
  assert.equal(fs.existsSync(path.join(disabled.path, 'SKILL.md')), true);

  const enabled = await manager.setEnabled({ id: disabled.id, enabled: true });
  assert.equal(enabled.enabled, true);
  assert.match(enabled.path, /skills[/\\]code-review$/);

  await assert.rejects(
    manager.install({ sourcePath: source, kind: 'directory', scope: 'user' }),
    /already installed/,
  );
});

test('project skills resolve to the nearest git root and removal uses Trash', async (t) => {
  const root = tempRoot(t);
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  const nested = path.join(project, 'packages', 'app');
  fs.mkdirSync(path.join(project, '.git'), { recursive: true });
  fs.mkdirSync(nested, { recursive: true });
  const source = makeSkill(path.join(root, 'sources'), 'project-checks');
  let trashed = null;
  const manager = new SkillManager({
    homeDir: home,
    trashItem: async (target) => { trashed = target; },
  });

  const installed = await manager.install({
    sourcePath: source,
    kind: 'directory',
    scope: 'project',
    cwd: nested,
  });
  assert.equal(installed.scope, 'project');
  assert.equal(
    installed.path,
    path.join(project, '.agents', 'skills', 'project-checks'),
  );

  const result = await manager.remove({ id: installed.id, cwd: nested });
  assert.deepEqual(result, { removed: true, name: 'project-checks' });
  assert.equal(trashed, installed.path);
});

test('rejects folders without SKILL.md and symbolic-link sources', async (t) => {
  const root = tempRoot(t);
  const home = path.join(root, 'home');
  const empty = path.join(root, 'empty');
  fs.mkdirSync(empty);
  const manager = new SkillManager({ homeDir: home, trashItem: async () => {} });

  await assert.rejects(
    manager.install({ sourcePath: empty, kind: 'directory' }),
    /does not contain SKILL[.]md/,
  );

  const source = makeSkill(path.join(root, 'sources'), 'linked');
  const linked = path.join(root, 'linked');
  fs.symlinkSync(source, linked, 'dir');
  await assert.rejects(
    manager.install({ sourcePath: linked, kind: 'directory' }),
    /Choose a local skill folder/,
  );
});
