'use strict';

/**
 * server-manager.js — locate the Kimi Code CLI and manage a `kimi web` server process.
 *
 * Used by main/kimi-client.js (KimiClient.launch) and main/main.js.
 *
 * Exports:
 *   resolveKimiPath(preferred?) -> Promise<string>
 *     Resolution order: explicit `preferred` arg -> env KIMI_CLI_PATH ->
 *     `which kimi` (`where kimi` on Windows) -> ~/.kimi-code/bin/kimi[.exe].
 *     Throws an Error with code 'KIMI_CLI_NOT_FOUND' when nothing is found.
 *   launchServer({ kimiPath?, port? } = {}) -> Promise<{ child, baseUrl, token, port, kimiPath }>
 *     Spawns `kimi web --no-open --port <port>`, waits for the stdout banner
 *     (boxed art containing `Local: http://127.0.0.1:<p>/#token=<TOKEN>`), and
 *     retries once on port+1 when the first attempt fails. All child output is
 *     forwarded to the console with a [kimi-server] prefix and tokens redacted.
 *   stopServer(child) -> Promise<void>
 *     SIGTERM (SIGKILL after grace) on POSIX, `taskkill /T /F` tree-kill on Windows.
 */

const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_PORT = 58930;
const BANNER_TIMEOUT_MS = 20000;
const KILL_GRACE_MS = 3000;

// The banner is a boxed ASCII-art block; the URL line looks like
// `  Local:    http://127.0.0.1:<p>/#token=<TOKEN>` (older docs: `Kimi server: <url>`).
// Match the URL itself so both formats work; the banner port is authoritative
// (the CLI auto-retries on port+1 itself).
const BANNER_RE = /(https?:\/\/[^\s/#]+(?::\d+)?)\/#token=(\S+)/i;
const TOKEN_IN_URL_RE = /#token=\S+/gi;
const TOKEN_LINE_RE = /^(\s*Token:\s*)\S+.*$/i;

function isWindows() {
  return process.platform === 'win32';
}

/** Strip tokens from a log line (banner URL form, `Token:` line, and any known token value). */
function redact(line, token) {
  let out = line.replace(TOKEN_IN_URL_RE, '#token=<redacted>');
  out = out.replace(TOKEN_LINE_RE, '$1<redacted>');
  if (token) out = out.split(token).join('<redacted>');
  return out;
}

function isExecutable(filePath) {
  try {
    if (isWindows()) {
      fs.accessSync(filePath, fs.constants.F_OK);
    } else {
      fs.accessSync(filePath, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function whichKimi() {
  return new Promise((resolve) => {
    execFile(isWindows() ? 'where' : 'which', ['kimi'], (err, stdout) => {
      if (err) return resolve(null);
      const first = String(stdout)
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find(Boolean);
      resolve(first || null);
    });
  });
}

async function resolveKimiPath(preferred) {
  const candidates = [];
  if (preferred) candidates.push(preferred);
  if (process.env.KIMI_CLI_PATH) candidates.push(process.env.KIMI_CLI_PATH);
  // eslint-disable-next-line no-await-in-loop
  const fromPathLookup = await whichKimi();
  if (fromPathLookup) candidates.push(fromPathLookup);
  candidates.push(
    path.join(os.homedir(), '.kimi-code', 'bin', isWindows() ? 'kimi.exe' : 'kimi'),
  );

  for (const candidate of candidates) {
    if (candidate && isExecutable(candidate)) return path.resolve(candidate);
  }
  const err = new Error(
    'Kimi Code CLI not found (looked in explicit path, KIMI_CLI_PATH, PATH lookup, ~/.kimi-code/bin)',
  );
  err.code = 'KIMI_CLI_NOT_FOUND';
  throw err;
}

function portFromBaseUrl(baseUrl, fallback) {
  const m = /:(\d+)$/.exec(baseUrl);
  return m ? Number(m[1]) : fallback;
}

function spawnAndWaitForBanner(kimiPath, port) {
  return new Promise((resolve, reject) => {
    const child = spawn(kimiPath, ['web', '--no-open', '--port', String(port)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: process.env,
    });

    let settled = false;
    let token = null;
    let stderrTail = '';
    const timer = setTimeout(() => {
      fail(new Error(`timed out after ${BANNER_TIMEOUT_MS}ms waiting for the server banner`));
    }, BANNER_TIMEOUT_MS);

    function fail(err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (stderrTail) err.message += ` — server stderr: ${redact(stderrTail, token).trim()}`;
      stopServer(child).finally(() => reject(err));
    }

    function handleLine(line, fromStderr) {
      console.log(`[kimi-server] ${redact(line, token)}`);
      if (fromStderr) {
        stderrTail = `${stderrTail}${line}\n`.slice(-2000);
        return;
      }
      if (!settled) {
        const m = BANNER_RE.exec(line);
        if (m) {
          token = m[2];
          settled = true;
          clearTimeout(timer);
          resolve({
            child,
            baseUrl: m[1],
            token,
            port: portFromBaseUrl(m[1], port), // banner port is authoritative (CLI may retry +1)
            kimiPath,
          });
        }
      }
    }

    function pipeLines(stream, fromStderr) {
      let buf = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, idx).replace(/\r$/, '');
          buf = buf.slice(idx + 1);
          handleLine(line, fromStderr);
        }
      });
      stream.on('end', () => {
        const rest = buf.trim();
        if (rest) handleLine(rest, fromStderr);
      });
    }

    pipeLines(child.stdout, false);
    pipeLines(child.stderr, true);

    child.on('error', (err) => fail(new Error(`failed to spawn "${kimiPath}": ${err.message}`)));
    child.on('exit', (code, signal) => {
      if (!settled) {
        fail(new Error(`kimi web exited before printing its banner (code ${code}, signal ${signal})`));
      } else {
        console.log(`[kimi-server] process exited (code ${code}, signal ${signal})`);
      }
    });
  });
}

async function launchServer({ kimiPath, port } = {}) {
  const bin = await resolveKimiPath(kimiPath);
  const startPort = Number.isInteger(port) ? port : DEFAULT_PORT;

  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const tryPort = startPort + attempt;
    try {
      // eslint-disable-next-line no-await-in-loop
      return await spawnAndWaitForBanner(bin, tryPort);
    } catch (err) {
      lastErr = err;
      console.warn(`[kimi-server] launch attempt on port ${tryPort} failed: ${redact(err.message, null)}`);
    }
  }
  throw lastErr;
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.pid == null || child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    if (isWindows()) {
      // Kill the whole process tree; /F forces, /T includes children.
      const tk = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      tk.on('error', () => resolve());
      tk.on('exit', () => resolve());
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      resolve();
    }, KILL_GRACE_MS);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      child.kill('SIGTERM');
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

module.exports = {
  DEFAULT_PORT,
  BANNER_RE,
  resolveKimiPath,
  launchServer,
  stopServer,
};
