'use strict';

/**
 * onboarding.js — first-run onboarding for Kimi Desktop (CONTRACT-V2, M1).
 *
 * Covers the two things the app needs before the backend can start:
 *   1. the Kimi Code CLI binary (auto-install via the official installer), and
 *   2. a Kimi login (device authorization flow via `kimi login`).
 *
 * Exports:
 *   getOnboardingState({ withVersion? } = {})
 *     -> { cliInstalled, cliPath, cliVersion, loggedIn, needsOnboarding }
 *        cliInstalled: resolveKimiPath() (./server-manager) succeeds.
 *        cliVersion:   first line of `kimi --version` (5s timeout, best-effort).
 *        loggedIn:     <KIMI_CODE_HOME|~/.kimi-code>/credentials/kimi-code.json
 *                      parses and has a non-empty access_token.
 *        needsOnboarding = !cliInstalled || !loggedIn.
 *   installCli(send) -> { ok, cliPath }
 *     Downloads the official installer and runs it (bash on POSIX, PowerShell
 *     on Windows — never sudo):
 *       macOS/Linux: curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash
 *       Windows:     irm https://code.kimi.com/kimi-code/install.ps1 | iex
 *     Both install the native binary to <home>/.kimi-code/bin/kimi[.exe] without
 *     touching the system. Progress is pushed as
 *       send({ type:'onboarding', phase:'install', step, message })
 *     (`step` is a snake_case machine key so the renderer can localize via T();
 *     `message` is a Korean fallback / raw installer line).
 *   startLogin(send) -> { verificationUrl, userCode }
 *     Spawns `kimi login` and regex-parses the device-flow verification URL and
 *     user code from its output (observed on stderr, both streams scanned):
 *       "Opening browser for Kimi device login: https://www.kimi.com/code/authorize_device?user_code=XXXX-XXXX"
 *       "If the browser did not open, paste the URL above and enter code: XXXX-XXXX"
 *     On child exit pushes send({ type:'onboarding', phase:'login', status:'done'|'error', message? }).
 *     If the CLI reports an existing login instead of a device flow, the promise
 *     rejects with err.code === 'ALREADY_LOGGED_IN' and status 'done' is pushed.
 *   cancelLogin() -> { ok }
 *     Kills the in-flight `kimi login` child (exit then pushes status 'error'
 *     with message 'cancelled').
 *
 * Never logs credential contents or tokens.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveKimiPath } = require('./server-manager');

const isWindows = process.platform === 'win32';

const INSTALL_SCRIPT_URL = isWindows
  ? 'https://code.kimi.com/kimi-code/install.ps1'
  : 'https://code.kimi.com/kimi-code/install.sh';
const MANUAL_INSTALL_URL = 'https://www.kimi.com/help/kimi-code/cli-getting-started';

const VERSION_TIMEOUT_MS = 5000;
const DOWNLOAD_TIMEOUT_MS = 30000;
const LOGIN_PARSE_TIMEOUT_MS = 60000;

const ANSI_RE = /\x1b\[[0-9;]*m/g;
// Device-flow lines printed by `kimi login` (verified live against 0.28.1).
const LOGIN_URL_RE = /https:\/\/\S*authorize_device\S*/i;
const LOGIN_CODE_RE = /(?:enter code|user_code)[:=]\s*([A-Za-z0-9-]+)/i;
const ALREADY_LOGGED_IN_RE = /^Logged in to /m;

/** Kimi Code home directory ( honors KIMI_CODE_HOME like the CLI does). */
function kimiHome() {
  return process.env.KIMI_CODE_HOME || path.join(os.homedir(), '.kimi-code');
}

/** True when the credentials file exists with a non-empty access_token. */
function checkLoggedIn() {
  try {
    const file = path.join(kimiHome(), 'credentials', 'kimi-code.json');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return typeof parsed.access_token === 'string' && parsed.access_token.length > 0;
  } catch {
    return false;
  }
}

/** `kimi --version`, first output line; null on any failure (5s cap). */
function getCliVersion(cliPath) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cliPath, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch {
      resolve(null);
      return;
    }
    let out = '';
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch { /* already gone */ }
      resolve(value);
    };
    const timer = setTimeout(() => done(null), VERSION_TIMEOUT_MS);
    child.stdout.on('data', (buf) => { out += buf.toString(); });
    child.on('error', () => done(null));
    child.on('exit', (code) => {
      if (code !== 0) return done(null);
      const line = out.replace(ANSI_RE, '').split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      done(line || null);
    });
  });
}

async function getOnboardingState({ withVersion = true } = {}) {
  let cliPath = null;
  try {
    cliPath = await resolveKimiPath();
  } catch {
    cliPath = null; // KIMI_CLI_NOT_FOUND or not executable
  }
  const cliVersion = cliPath && withVersion ? await getCliVersion(cliPath) : null;
  const loggedIn = checkLoggedIn();
  const cliInstalled = Boolean(cliPath);
  return {
    cliInstalled,
    cliPath,
    cliVersion,
    loggedIn,
    needsOnboarding: !cliInstalled || !loggedIn,
  };
}

// ------------------------------------------------------------- CLI install --

let installInFlight = false;

/** Download the official installer script to a temp file and return its path. */
async function downloadInstaller() {
  const res = await fetch(INSTALL_SCRIPT_URL, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`installer download failed: HTTP ${res.status}`);
  const body = await res.text();
  if (!body || !body.trim()) throw new Error('installer download was empty');
  const scriptPath = path.join(
    os.tmpdir(),
    `kimi-code-install-${process.pid}${isWindows ? '.ps1' : '.sh'}`,
  );
  fs.writeFileSync(scriptPath, body, { mode: 0o755 });
  return scriptPath;
}

/**
 * Run the official CLI installer and stream its output as progress events.
 * The installer itself needs no sudo: it drops a native binary into
 * ~/.kimi-code/bin and (by default) adds it to the user PATH.
 */
async function installCli(send) {
  if (installInFlight) throw new Error('CLI install is already in progress');
  installInFlight = true;
  const progress = (step, message) => {
    try {
      send({ type: 'onboarding', phase: 'install', step, message });
    } catch {
      /* renderer may be gone mid-install */
    }
  };

  let scriptPath = null;
  try {
    progress('download_script', '설치 스크립트를 다운로드하는 중…');
    scriptPath = await downloadInstaller();

    progress('run_installer', 'Kimi Code CLI를 설치하는 중…');
    const child = isWindows
      ? spawn(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
          { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
        )
      : spawn('bash', [scriptPath], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderrTail = '';
    const onLine = (line, isErr) => {
      const clean = line.replace(ANSI_RE, '').trim();
      if (!clean) return;
      if (isErr) stderrTail = `${stderrTail}${clean}\n`.slice(-2000);
      progress('run_installer', clean);
    };
    const pipeLines = (stream, isErr) => {
      let buf = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf('\n')) !== -1) {
          onLine(buf.slice(0, idx), isErr);
          buf = buf.slice(idx + 1);
        }
      });
      stream.on('end', () => onLine(buf, isErr));
    };
    pipeLines(child.stdout, false);
    pipeLines(child.stderr, true);

    // 'close' (not 'exit'): fires only after stdio flushed, so stderrTail is complete.
    const exitCode = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) => resolve(code ?? -1));
    });
    if (exitCode !== 0) {
      const tail = stderrTail.trim();
      throw new Error(
        `CLI installer exited with code ${exitCode}${tail ? `: ${tail}` : ''}. ` +
          `수동 설치: ${MANUAL_INSTALL_URL}`,
      );
    }

    progress('verify', '설치를 확인하는 중…');
    const cliPath = await resolveKimiPath(); // throws KIMI_CLI_NOT_FOUND
    progress('done', '설치가 완료되었습니다.');
    return { ok: true, cliPath };
  } catch (err) {
    progress('error', err.message);
    if (err.code !== 'KIMI_CLI_NOT_FOUND') {
      err.message = `${err.message} (수동 설치 안내: ${MANUAL_INSTALL_URL})`;
    }
    throw err;
  } finally {
    installInFlight = false;
    if (scriptPath) {
      try { fs.unlinkSync(scriptPath); } catch { /* temp file may be gone */ }
    }
  }
}

// ----------------------------------------------------------------- login ----

/** @type {import('node:child_process').ChildProcess | null} */
let loginChild = null;
let loginPush = null;     // send() of the in-flight attempt, for instant cancel feedback
let loginNotified = false; // a terminal status was already pushed

/**
 * Spawn `kimi login`, parse the device-flow URL + code, resolve with them.
 * Completion is reported via push events (see header comment).
 */
async function startLogin(send) {
  cancelLogin(); // drop any dangling attempt before starting a new one
  const push = (payload) => {
    try {
      send({ type: 'onboarding', phase: 'login', ...payload });
    } catch {
      /* renderer may be gone */
    }
  };

  const cliPath = await resolveKimiPath(); // throws when the CLI is missing
  loginNotified = false;
  loginPush = push;
  const child = spawn(cliPath, ['login'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child._kimiLoginCancelled = false; // per-attempt flag: a superseded child's
  loginChild = child;                // late 'close' must not touch the new attempt

  return new Promise((resolve, reject) => {
    let settled = false;
    let buffer = '';
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killLogin(false); // no 'cancelled' status here — the rejection says why
      reject(new Error('timed out waiting for the login verification URL'));
    }, LOGIN_PARSE_TIMEOUT_MS);

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value);
    };

    const tryParse = (chunk) => {
      buffer += chunk.toString().replace(ANSI_RE, '');
      if (settled) return;
      const urlMatch = LOGIN_URL_RE.exec(buffer);
      if (!urlMatch) return;
      const verificationUrl = urlMatch[0];
      const codeMatch = LOGIN_CODE_RE.exec(buffer);
      // Fallback: the URL itself carries ?user_code=XXXX-XXXX.
      const userCode = codeMatch
        ? codeMatch[1]
        : (/[?&]user_code=([A-Za-z0-9-]+)/.exec(verificationUrl) || [])[1];
      if (verificationUrl && userCode) finish(null, { verificationUrl, userCode });
    };

    child.stdout.on('data', tryParse); // observed on stderr; scan both to be safe
    child.stderr.on('data', tryParse);

    child.on('error', (err) => {
      loginChild = null;
      loginNotified = true;
      push({ status: 'error', message: err.message });
      finish(err);
    });

    // 'close' (not 'exit'): stdio is flushed by then, so `buffer` holds the
    // final lines (e.g. the "Logged in to ..." short-circuit) when we check.
    child.on('close', (code, signal) => {
      if (loginChild === child) loginChild = null;
      if (child._kimiLoginCancelled) {
        // Status was already pushed by cancelLogin(); nothing more to do.
        finish(new Error('login cancelled'));
        return;
      }
      if (code === 0) {
        if (!settled && ALREADY_LOGGED_IN_RE.test(buffer)) {
          // `kimi login` short-circuits when a valid login already exists.
          const err = new Error('already logged in');
          err.code = 'ALREADY_LOGGED_IN';
          loginNotified = true;
          push({ status: 'done' });
          finish(err);
          return;
        }
        loginNotified = true;
        push({ status: 'done' });
        if (!settled) {
          finish(new Error(`kimi login exited (code 0) without a verification URL: ${buffer.slice(-200)}`));
        }
        return;
      }
      loginNotified = true;
      const message = `kimi login exited (code ${code}, signal ${signal})`;
      push({ status: 'error', message });
      finish(new Error(message));
    });
  });
}

/** Kill the in-flight login child without touching flags. Returns whether one was running. */
function killLogin(cancelled) {
  const child = loginChild;
  loginChild = null;
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return false;
  }
  child._kimiLoginCancelled = Boolean(cancelled);
  try {
    child.kill();
  } catch {
    /* already gone */
  }
  return true;
}

/**
 * Kill the in-flight `kimi login` child. Pushes the terminal
 * {phase:'login', status:'error', message:'cancelled'} immediately (the
 * 'close' event may lag when grandchildren hold the pipes open).
 */
function cancelLogin() {
  if (!killLogin(true)) return { ok: false };
  if (loginPush && !loginNotified) {
    loginNotified = true;
    loginPush({ status: 'error', message: 'cancelled' });
  }
  return { ok: true };
}

module.exports = {
  getOnboardingState,
  installCli,
  startLogin,
  cancelLogin,
  // Exported for tests / other main modules:
  checkLoggedIn,
  kimiHome,
};
