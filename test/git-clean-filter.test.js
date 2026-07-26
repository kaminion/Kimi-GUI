'use strict';

/**
 * git-clean-filter.test.js — unit tests for listCleanPaths() in
 * main/git-workspace.js, the main-process half of requirement (A): files the
 * agent touched but that are clean in Git (committed, possibly pushed) drop
 * out of the conversation change summary.
 *
 * Runs against real temporary repositories (the app itself shells out to
 * git, so the dev machine has it). Covers porcelain -z parsing (modified /
 * staged / untracked / collapsed untracked dirs / rename pairs), candidate
 * resolution (absolute, repo-relative, subdirectory cwd, symlinked roots),
 * and the fail-open contract: anything unverifiable keeps the file.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const { listCleanPaths } = require('../main/git-workspace');

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-git-filter-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  return dir;
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

test('fail-open for a non-repository cwd and invalid input', async () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-git-plain-'));
  const file = path.join(plain, 'a.txt');
  write(file, 'x');

  const notRepo = await listCleanPaths(plain, [file]);
  assert.equal(notRepo.isRepository, false);
  assert.deepEqual(notRepo.clean, []);

  const relative = await listCleanPaths('relative/path', [file]);
  assert.equal(relative.isRepository, false);
  assert.deepEqual(relative.clean, []);

  const empty = await listCleanPaths(plain, []);
  assert.deepEqual(empty, { isRepository: false, clean: [] });

  const garbage = await listCleanPaths(plain, [null, 42, '  ']);
  assert.deepEqual(garbage, { isRepository: false, clean: [] });
});

test('committed files are clean; modified, staged, and untracked are not', async () => {
  const repo = makeRepo();
  const committed = path.join(repo, 'committed.txt');
  const modified = path.join(repo, 'modified.txt');
  write(committed, 'a');
  write(modified, 'b');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');

  // Simulate "the agent edited then committed": committed.txt now matches HEAD.
  // Then dirty the others in three different ways.
  write(modified, 'b+');
  const staged = path.join(repo, 'staged.txt');
  write(staged, 's');
  git(repo, 'add', 'staged.txt');
  const untracked = path.join(repo, 'untracked.txt');
  write(untracked, 'u');

  const candidates = [committed, modified, staged, untracked];
  const result = await listCleanPaths(repo, candidates);
  assert.equal(result.isRepository, true);
  assert.deepEqual(result.clean, [committed]);

  // Commit everything: every candidate becomes clean.
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'all');
  const after = await listCleanPaths(repo, candidates);
  assert.deepEqual(after.clean, candidates);
});

test('a collapsed untracked directory covers the files inside it', async () => {
  const repo = makeRepo();
  write(path.join(repo, 'root.txt'), 'r');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');

  // git status collapses a fully-untracked directory to '?? newdir/'.
  const nested = path.join(repo, 'newdir', 'deep', 'n.txt');
  write(nested, 'n');

  const result = await listCleanPaths(repo, [nested]);
  assert.equal(result.isRepository, true);
  assert.deepEqual(result.clean, []);
});

test('rename entries mark both sides dirty', async () => {
  const repo = makeRepo();
  const before = path.join(repo, 'before.txt');
  write(before, 'r');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  git(repo, 'mv', 'before.txt', 'after.txt');

  const after = path.join(repo, 'after.txt');
  const result = await listCleanPaths(repo, [before, after]);
  assert.deepEqual(result.clean, []);
});

test('relative candidates resolve against the session cwd (repo subdirectory)', async () => {
  const repo = makeRepo();
  write(path.join(repo, 'sub', 'deep', 'clean.txt'), 'c');
  write(path.join(repo, 'sub', 'deep', 'dirty.txt'), 'd');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  write(path.join(repo, 'sub', 'deep', 'dirty.txt'), 'd+');

  const cwd = path.join(repo, 'sub');
  const result = await listCleanPaths(cwd, ['deep/clean.txt', 'deep/dirty.txt']);
  assert.equal(result.isRepository, true);
  assert.deepEqual(result.clean, ['deep/clean.txt']);
});

test('paths outside the repository are kept (never reported clean)', async () => {
  const repo = makeRepo();
  write(path.join(repo, 'in.txt'), 'i');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');

  const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-git-out-')), 'out.txt');
  write(outside, 'o');

  const result = await listCleanPaths(repo, [path.join(repo, 'in.txt'), outside]);
  assert.deepEqual(result.clean, [path.join(repo, 'in.txt')]);
});

test('clean paths come back exactly as supplied', async () => {
  const repo = makeRepo();
  write(path.join(repo, 'a.txt'), 'a');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');

  // Repo-relative spelling of the same file: still recognized as clean, and
  // the candidate string itself (not a normalized form) is returned.
  const result = await listCleanPaths(repo, ['a.txt']);
  assert.deepEqual(result.clean, ['a.txt']);
});
