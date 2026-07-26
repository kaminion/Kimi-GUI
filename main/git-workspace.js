'use strict';

/**
 * Small, shell-free Git facade used by the new-chat project controls.
 *
 * Every command is executed with an argv array (never through a shell).
 * Branch switching is limited to a branch returned by `listInfo()` for the
 * same worktree, so renderer input cannot be interpreted as an option or an
 * arbitrary refspec.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const COMMAND_TIMEOUT_MS = 5000;
const MAX_BUFFER = 1024 * 1024;

function runGit(cwd, args, { raw = false } = {}) {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', cwd, ...args],
      { timeout: COMMAND_TIMEOUT_MS, maxBuffer: MAX_BUFFER, windowsHide: true },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          // Porcelain -z output is parsed positionally (leading status spaces
          // matter), so callers opt out of trimming with { raw: true }.
          stdout: raw ? String(stdout || '') : String(stdout || '').trim(),
          stderr: String(stderr || '').trim(),
          error,
        });
      },
    );
  });
}

function validCwd(cwd) {
  return typeof cwd === 'string' && cwd.trim() && path.isAbsolute(cwd);
}

async function listInfo(cwd) {
  if (!validCwd(cwd)) {
    return { isRepository: false, current: null, branches: [] };
  }

  const inside = await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.stdout !== 'true') {
    return { isRepository: false, current: null, branches: [] };
  }

  const [currentResult, branchesResult] = await Promise.all([
    runGit(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
    runGit(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']),
  ]);
  const branches = branchesResult.ok
    ? branchesResult.stdout.split(/\r?\n/).map((name) => name.trim()).filter(Boolean)
    : [];

  return {
    isRepository: true,
    current: currentResult.ok && currentResult.stdout ? currentResult.stdout : null,
    branches,
  };
}

async function checkout(cwd, branch) {
  const info = await listInfo(cwd);
  const wanted = typeof branch === 'string' ? branch.trim() : '';
  if (!info.isRepository) throw new Error('선택한 프로젝트는 Git 저장소가 아닙니다.');
  if (!wanted || !info.branches.includes(wanted)) {
    throw new Error('선택한 브랜치를 이 프로젝트에서 찾을 수 없습니다.');
  }
  if (info.current === wanted) return { ...info, changed: false };

  // `git switch` gives clearer safety errors. Older Git versions fall back to
  // checkout; neither command uses --force, so local work is never overwritten.
  let result = await runGit(cwd, ['switch', wanted]);
  if (!result.ok && /not a git command|unknown subcommand/i.test(`${result.stderr}\n${result.stdout}`)) {
    result = await runGit(cwd, ['checkout', wanted]);
  }
  if (!result.ok) {
    throw new Error(result.stderr || result.stdout || '브랜치를 전환하지 못했습니다.');
  }
  const updated = await listInfo(cwd);
  return { ...updated, changed: true };
}

// ---- committed-change filtering ---------------------------------------------
// The renderer's change summary should drop files that are clean in Git
// (committed, possibly pushed). `git status --porcelain -z` lists every dirty
// path relative to the repository root (even when run from a subdirectory);
// anything inside the repo but absent from that list is clean.

function parsePorcelainZ(raw) {
  const dirtyFiles = new Set();
  const dirtyDirs = new Set();
  const addPath = (p) => {
    if (p.endsWith('/')) dirtyDirs.add(p.slice(0, -1));
    else dirtyFiles.add(p);
  };
  const entries = String(raw).split('\0');
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.length < 4) continue; // needs XY status + space + path
    const x = entry[0];
    const y = entry[1];
    const p = entry.slice(3);
    if (!p) continue;
    addPath(p);
    // Rename/copy entries carry a second NUL-separated token (the source
    // path); both sides count as dirty.
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      const from = entries[++i];
      if (from) addPath(from);
    }
  }
  return { dirtyFiles, dirtyDirs };
}

// A repo-relative path is dirty when listed itself, or when a collapsed
// untracked directory ('?? dir/') contains it.
function isDirtyRel(rel, { dirtyFiles, dirtyDirs }) {
  if (dirtyFiles.has(rel)) return true;
  let slash = rel.indexOf('/');
  while (slash !== -1) {
    if (dirtyDirs.has(rel.slice(0, slash))) return true;
    slash = rel.indexOf('/', slash + 1);
  }
  return false;
}

/**
 * Return the subset of `candidates` (paths exactly as supplied) that live
 * inside the repository at `cwd` and are clean in Git. Fail-open: a non-repo
 * cwd, invalid input, or a failed git call yields an empty `clean` list, so
 * the renderer keeps every file. Paths outside the repo cannot be verified
 * clean and are kept as well.
 */
async function listCleanPaths(cwd, candidates) {
  const paths = Array.isArray(candidates)
    ? candidates.filter((p) => typeof p === 'string' && p.trim())
    : [];
  if (!validCwd(cwd) || !paths.length) return { isRepository: false, clean: [] };

  const inside = await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.stdout !== 'true') return { isRepository: false, clean: [] };

  const [topResult, statusResult] = await Promise.all([
    runGit(cwd, ['rev-parse', '--show-toplevel']),
    runGit(cwd, ['status', '--porcelain=v1', '-z'], { raw: true }),
  ]);
  if (!topResult.ok || !topResult.stdout || !statusResult.ok) {
    return { isRepository: true, clean: [] };
  }
  const dirty = parsePorcelainZ(statusResult.stdout);

  // The picker/agent may hand us symlinked paths while Git reports the
  // physical root (e.g. /tmp vs /private/tmp on macOS), so match against
  // both spellings of the root and realpath the candidates too (a deleted
  // file's realpath is approximated through its parent directory).
  const roots = [topResult.stdout];
  try {
    const real = fs.realpathSync(topResult.stdout);
    if (real !== topResult.stdout) roots.push(real);
  } catch { /* root always exists; ignore */ }
  let cwdReal = cwd;
  try { cwdReal = fs.realpathSync(cwd); } catch { /* keep the raw cwd */ }
  const realpathLoose = (p) => {
    try { return fs.realpathSync(p); } catch { /* deleted file: try the parent */ }
    try { return path.join(fs.realpathSync(path.dirname(p)), path.basename(p)); }
    catch { return null; }
  };

  const relInside = (abs) => {
    for (const root of roots) {
      const rel = path.relative(root, abs);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        return rel.split(path.sep).join('/');
      }
    }
    return null;
  };

  const clean = [];
  for (const candidate of paths) {
    const forms = [];
    const addForm = (p) => { if (p && !forms.includes(p)) forms.push(p); };
    if (path.isAbsolute(candidate)) {
      addForm(candidate);
    } else {
      addForm(path.resolve(cwd, candidate));
      addForm(path.resolve(cwdReal, candidate));
    }
    for (const abs of [...forms]) addForm(realpathLoose(abs));
    let insideRepo = false;
    let isDirty = false;
    for (const abs of forms) {
      const rel = relInside(abs);
      if (rel == null) continue;
      insideRepo = true;
      isDirty = isDirtyRel(rel, dirty);
      break; // first form that lands inside the repo wins
    }
    if (insideRepo && !isDirty) clean.push(candidate);
  }
  return { isRepository: true, clean };
}

module.exports = { listInfo, checkout, listCleanPaths };
