'use strict';

/**
 * Local Agent Skills repository.
 *
 * Kimi Code discovers skills from well-known user and project directories.
 * This module keeps those filesystem rules outside IPC/UI code and provides
 * serialized, recoverable mutations:
 *
 *   add      copy to a staging path, validate, then rename atomically
 *   disable  move from `skills` to the adjacent `skills-disabled`
 *   enable   move back to the original discovery root
 *   remove   delegate to Electron's OS trash
 *
 * It intentionally does not edit Kimi's config.toml or follow symlinks.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const USER_ROOTS = [
  { family: 'kimi', parts: ['.kimi'] },
  { family: 'claude', parts: ['.claude'] },
  { family: 'codex', parts: ['.codex'] },
  { family: 'agents', parts: ['.config', 'agents'] },
  { family: 'agents-legacy', parts: ['.agents'] },
];

const PROJECT_ROOTS = [
  { family: 'kimi', parts: ['.kimi'] },
  { family: 'claude', parts: ['.claude'] },
  { family: 'codex', parts: ['.codex'] },
  { family: 'agents', parts: ['.agents'] },
];

const DESCRIPTION_FALLBACK = 'No description provided.';
const DESCRIPTION_MAX = 240;

function exists(target) {
  return fsp.access(target).then(() => true, () => false);
}

function pathId(target, enabled) {
  return createHash('sha256')
    .update(enabled ? 'enabled\0' : 'disabled\0')
    .update(path.resolve(target))
    .digest('hex')
    .slice(0, 24);
}

function unquote(value) {
  const text = String(value ?? '').trim();
  if (
    text.length >= 2 &&
    ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'")))
  ) {
    return text.slice(1, -1).trim();
  }
  return text;
}

function parseSkillText(text, fallbackName) {
  const raw = String(text ?? '').replace(/^\uFEFF/, '');
  let body = raw;
  const fields = {};
  if (raw.startsWith('---')) {
    const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(raw);
    if (match) {
      body = raw.slice(match[0].length);
      for (const line of match[1].split(/\r?\n/)) {
        const field = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(line);
        if (field) fields[field[1].toLowerCase()] = unquote(field[2]);
      }
    }
  }
  const firstBodyLine = body
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find(Boolean);
  return {
    name: fields.name || fallbackName,
    description: (fields.description || firstBodyLine || DESCRIPTION_FALLBACK)
      .slice(0, DESCRIPTION_MAX),
    type: fields.type === 'flow' ? 'flow' : 'standard',
  };
}

function safeInstallName(value, fallback) {
  const normalized = String(value || fallback || 'skill')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (!normalized || normalized === '.' || normalized === '..') {
    throw new Error('The skill name is not valid.');
  }
  return normalized;
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function findProjectRoot(cwd) {
  if (typeof cwd !== 'string' || !cwd.trim()) return null;
  let current = path.resolve(cwd);
  try {
    const stat = await fsp.stat(current);
    if (!stat.isDirectory()) current = path.dirname(current);
  } catch {
    return null;
  }
  const fallback = current;
  while (true) {
    if (await exists(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return fallback;
    current = parent;
  }
}

function rootSpec(base, scope, spec) {
  const parent = path.join(base, ...spec.parts);
  return {
    scope,
    family: spec.family,
    activeRoot: path.join(parent, 'skills'),
    disabledRoot: path.join(parent, 'skills-disabled'),
  };
}

async function readSkillEntry(entryPath, entry, root, enabled) {
  const stat = await fsp.lstat(entryPath);
  if (stat.isSymbolicLink()) return null;

  let markdownPath;
  let kind;
  let fallbackName;
  if (stat.isDirectory()) {
    markdownPath = path.join(entryPath, 'SKILL.md');
    if (!(await exists(markdownPath))) return null;
    kind = 'directory';
    fallbackName = entry.name;
  } else if (stat.isFile() && entry.name.toLowerCase().endsWith('.md') && entry.name !== 'SKILL.md') {
    markdownPath = entryPath;
    kind = 'file';
    fallbackName = path.basename(entry.name, path.extname(entry.name));
  } else {
    return null;
  }

  let parsed;
  try {
    parsed = parseSkillText(await fsp.readFile(markdownPath, 'utf8'), fallbackName);
  } catch {
    return null;
  }
  return {
    id: pathId(entryPath, enabled),
    name: parsed.name,
    description: parsed.description,
    type: parsed.type,
    scope: root.scope,
    family: root.family,
    enabled,
    kind,
    path: entryPath,
    activeRoot: root.activeRoot,
    disabledRoot: root.disabledRoot,
  };
}

async function scanRoot(root, enabled) {
  const container = enabled ? root.activeRoot : root.disabledRoot;
  let entries;
  try {
    entries = await fsp.readdir(container, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EACCES') return [];
    throw error;
  }
  const skills = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.kimi-gui-install-')) continue;
    // eslint-disable-next-line no-await-in-loop
    const skill = await readSkillEntry(path.join(container, entry.name), entry, root, enabled);
    if (skill) skills.push(skill);
  }
  return skills;
}

function publicSkill(skill) {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    type: skill.type,
    scope: skill.scope,
    family: skill.family,
    enabled: skill.enabled,
    path: skill.path,
  };
}

class SkillManager {
  constructor({ homeDir = os.homedir(), trashItem } = {}) {
    this.homeDir = path.resolve(homeDir);
    this.trashItem = trashItem;
    this.records = new Map();
    this.mutationTail = Promise.resolve();
  }

  async _roots(cwd) {
    const roots = USER_ROOTS.map((spec) => rootSpec(this.homeDir, 'user', spec));
    const projectRoot = await findProjectRoot(cwd);
    if (projectRoot) {
      roots.push(...PROJECT_ROOTS.map((spec) => rootSpec(projectRoot, 'project', spec)));
    }
    return { roots, projectRoot };
  }

  async list({ cwd } = {}) {
    const { roots, projectRoot } = await this._roots(cwd);
    const nested = await Promise.all(
      roots.flatMap((root) => [scanRoot(root, true), scanRoot(root, false)]),
    );
    const records = nested.flat();
    records.sort((a, b) => (
      Number(b.enabled) - Number(a.enabled) ||
      a.scope.localeCompare(b.scope) ||
      a.name.localeCompare(b.name)
    ));
    this.records = new Map(records.map((record) => [record.id, record]));
    return {
      projectRoot,
      userInstallRoot: path.join(this.homeDir, '.config', 'agents', 'skills'),
      projectInstallRoot: projectRoot ? path.join(projectRoot, '.agents', 'skills') : null,
      skills: records.map(publicSkill),
    };
  }

  _serialize(operation) {
    const run = this.mutationTail.then(operation, operation);
    this.mutationTail = run.catch(() => {});
    return run;
  }

  async _resolve(id, cwd) {
    await this.list({ cwd });
    const record = this.records.get(String(id));
    if (!record) throw new Error('The skill no longer exists. Refresh the list and try again.');
    const root = record.enabled ? record.activeRoot : record.disabledRoot;
    if (!isInside(root, record.path)) throw new Error('The skill path is outside its managed root.');
    return record;
  }

  setEnabled({ id, enabled, cwd } = {}) {
    return this._serialize(async () => {
      const record = await this._resolve(id, cwd);
      const wanted = !!enabled;
      if (record.enabled === wanted) return publicSkill(record);
      const destinationRoot = wanted ? record.activeRoot : record.disabledRoot;
      const destination = path.join(destinationRoot, path.basename(record.path));
      await fsp.mkdir(destinationRoot, { recursive: true });
      if (await exists(destination)) {
        throw new Error(`A skill named "${path.basename(destination)}" already exists in the destination.`);
      }
      await fsp.rename(record.path, destination);
      const refreshed = await this.list({ cwd });
      return refreshed.skills.find((skill) => path.resolve(skill.path) === path.resolve(destination)) ?? null;
    });
  }

  remove({ id, cwd } = {}) {
    return this._serialize(async () => {
      const record = await this._resolve(id, cwd);
      if (typeof this.trashItem !== 'function') {
        throw new Error('Moving skills to the Trash is unavailable.');
      }
      await this.trashItem(record.path);
      return { removed: true, name: record.name };
    });
  }

  install({ sourcePath, kind, scope = 'user', cwd } = {}) {
    return this._serialize(async () => {
      const source = path.resolve(String(sourcePath || ''));
      const sourceStat = await fsp.lstat(source).catch(() => null);
      if (!sourceStat || sourceStat.isSymbolicLink()) {
        throw new Error('Choose a local skill folder or Markdown file.');
      }

      const { projectRoot } = await this._roots(cwd);
      const destinationRoot = scope === 'project'
        ? (projectRoot ? path.join(projectRoot, '.agents', 'skills') : null)
        : path.join(this.homeDir, '.config', 'agents', 'skills');
      if (!destinationRoot) throw new Error('Choose a project directory before adding a project skill.');

      let markdownPath;
      let entryKind;
      let fallbackName;
      if (kind === 'directory' && sourceStat.isDirectory()) {
        markdownPath = path.join(source, 'SKILL.md');
        if (!(await exists(markdownPath))) {
          throw new Error('The selected folder does not contain SKILL.md.');
        }
        entryKind = 'directory';
        fallbackName = path.basename(source);
      } else if (
        kind === 'file' &&
        sourceStat.isFile() &&
        source.toLowerCase().endsWith('.md')
      ) {
        markdownPath = source;
        entryKind = 'file';
        fallbackName = path.basename(source, path.extname(source));
      } else {
        throw new Error(kind === 'file'
          ? 'Choose a Markdown skill file.'
          : 'Choose a folder containing SKILL.md.');
      }

      const parsed = parseSkillText(await fsp.readFile(markdownPath, 'utf8'), fallbackName);
      const installName = safeInstallName(parsed.name, fallbackName);
      const fileName = entryKind === 'file' ? `${installName}.md` : installName;
      const destination = path.join(destinationRoot, fileName);
      await fsp.mkdir(destinationRoot, { recursive: true });
      if (await exists(destination)) {
        throw new Error(`A skill named "${installName}" is already installed in this scope.`);
      }

      const stage = path.join(destinationRoot, `.kimi-gui-install-${randomUUID()}`);
      try {
        if (entryKind === 'directory') {
          await fsp.cp(source, stage, { recursive: true, force: false, errorOnExist: true });
          if (!(await exists(path.join(stage, 'SKILL.md')))) {
            throw new Error('The copied skill is missing SKILL.md.');
          }
        } else {
          await fsp.copyFile(source, stage, fs.constants.COPYFILE_EXCL);
        }
        await fsp.rename(stage, destination);
      } catch (error) {
        await fsp.rm(stage, { recursive: true, force: true }).catch(() => {});
        throw error;
      }

      const refreshed = await this.list({ cwd });
      return refreshed.skills.find((skill) => path.resolve(skill.path) === path.resolve(destination)) ?? {
        name: parsed.name,
        path: destination,
        enabled: true,
        scope,
      };
    });
  }
}

module.exports = {
  SkillManager,
  findProjectRoot,
  parseSkillText,
};
