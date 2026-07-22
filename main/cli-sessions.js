'use strict';

// Read/append adapter over the Kimi Code CLI's on-disk session store
// (CONTRACT-V4, M1). Lets the direct engine list, open, rename, archive and
// CONTINUE legacy CLI sessions without spawning `kimi web`.
//
// Verified on-disk layout (kimi 0.28.1):
//   <KIMI_CODE_HOME|~/.kimi-code>/sessions/<wd_*>/<session_id>/
//     state.json                {id,cwd,title,lastPrompt,createdAt,updatedAt(ms),
//                                archived,isCustomTitle, ...unknown fields preserved}
//     agents/main/wire.jsonl    same event-log format main/direct-store.js writes
//
// The session id is the DIRECTORY name (mirrors main/search.js); state.id is
// not consulted. wire parsing and turn appending are delegated to a
// direct-store instance rooted at the session's WORKSPACE dir (<wd_*>), so the
// wire format can never drift between the two engines. Every state.json
// mutation is a read-modify-write of the parsed object: unknown fields survive.

const fs = require('fs/promises');
const os = require('os');
const path = require('path');

function kimiHome() {
  const home = process.env.KIMI_CODE_HOME;
  return home && home.trim() ? home.trim() : path.join(os.homedir(), '.kimi-code');
}

function sessionsRoot() {
  return path.join(kimiHome(), 'sessions');
}

async function readJsonOrNull(p) {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch {
    return null;
  }
}

// Atomic-ish write: tmp file + rename so a crash never leaves half a state.json.
async function writeJson(p, obj) {
  const tmp = `${p}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(obj), 'utf8');
  await fs.rename(tmp, p);
}

function toIso(ms) {
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

// Lazy guarded require of the sibling direct-store (parallel-swarm module):
// a missing module degrades reads to [] and writes to a thrown error, never a crash.
let storeMod = null;
function loadStoreMod() {
  if (storeMod) return storeMod;
  try {
    // eslint-disable-next-line global-require
    storeMod = require('./direct-store');
  } catch {
    storeMod = null;
  }
  return storeMod;
}

function isSafeId(id) {
  return typeof id === 'string' && id.length > 0 && !id.includes('/') && !id.includes('\\') && id !== '.' && id !== '..';
}

/**
 * Locate a session dir by id across all <wd_*> workspaces.
 * Returns { id, dir, workspaceDir, state } or null (no CLI home, unknown id).
 */
async function resolve(id) {
  if (!isSafeId(id)) return null;
  const root = sessionsRoot();
  let workspaces;
  try {
    workspaces = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return null; // ~/.kimi-code (or its sessions dir) does not exist
  }
  for (const ws of workspaces) {
    if (!ws.isDirectory()) continue;
    const dir = path.join(root, ws.name, id);
    const state = await readJsonOrNull(path.join(dir, 'state.json'));
    if (state && typeof state === 'object') {
      return { id, dir, workspaceDir: ws.name, state };
    }
  }
  return null;
}

function summary(id, state) {
  const title =
    (typeof state.title === 'string' && state.title) ||
    (typeof state.lastPrompt === 'string' && state.lastPrompt) ||
    '새 대화';
  return {
    id,
    title,
    cwd: typeof state.cwd === 'string' ? state.cwd : '',
    updatedAt: toIso(state.updatedAt) ?? toIso(state.createdAt),
    busy: false,
    engine: 'cli',
    model: typeof state.model === 'string' && state.model ? state.model : null,
    effort: null,
  };
}

/**
 * All non-archived CLI sessions, newest first ([] when no CLI home exists).
 * @returns {Promise<Array<{id:string,title:string,cwd:string,updatedAt:string|null,
 *   busy:false,engine:'cli',model:string|null,effort:null}>>}
 */
async function list() {
  const root = sessionsRoot();
  let workspaces;
  try {
    workspaces = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const ws of workspaces) {
    if (!ws.isDirectory()) continue;
    let dirs;
    try {
      dirs = await fs.readdir(path.join(root, ws.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const state = await readJsonOrNull(path.join(root, ws.name, d.name, 'state.json'));
      if (!state || typeof state !== 'object' || state.archived) continue;
      found.push({
        id: d.name,
        state,
        updatedAtMs: typeof state.updatedAt === 'number' && Number.isFinite(state.updatedAt) ? state.updatedAt : 0,
      });
    }
  }
  found.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  return found.map(({ id, state }) => summary(id, state));
}

/**
 * direct-store shim over a CLI session's workspace dir: exposes
 * get/getMessages/appendTurn/setConfig/usageByDay for that session id.
 * Null when the session (or the direct-store module) is unavailable.
 */
async function storeFor(id) {
  const found = await resolve(id);
  if (!found) return null;
  const mod = loadStoreMod();
  if (!mod || typeof mod.createStore !== 'function') return null;
  try {
    return mod.createStore({ root: path.dirname(found.dir) });
  } catch {
    return null;
  }
}

/** REST-shaped messages replayed from wire.jsonl, chronological (newest LAST). */
async function getMessages(id) {
  const store = await storeFor(id);
  if (!store) return [];
  try {
    const messages = await store.getMessages(id);
    return Array.isArray(messages) ? messages : [];
  } catch {
    return [];
  }
}

/** Rename; marks the title as custom. Preserves unknown state.json fields. */
async function rename(id, title) {
  const found = await resolve(id);
  if (!found) throw new Error(`cli-sessions: no such session ${id}`);
  const state = found.state;
  state.title = String(title ?? '');
  state.isCustomTitle = true;
  state.updatedAt = Date.now();
  await writeJson(path.join(found.dir, 'state.json'), state);
  return summary(id, state);
}

/** Soft-delete: sets archived=true. The transcript stays on disk for the CLI. */
async function archive(id) {
  const found = await resolve(id);
  if (!found) throw new Error(`cli-sessions: no such session ${id}`);
  found.state.archived = true;
  await writeJson(path.join(found.dir, 'state.json'), found.state);
  return { archived: true, id };
}

/**
 * Append a direct-engine turn to the CLI session's wire.jsonl and bump
 * state.json updatedAt/lastPrompt. Delegates to direct-store's appendTurn so
 * the appended lines are byte-compatible with what the CLI itself writes;
 * unknown state.json fields are preserved.
 */
async function appendTurnCompat(id, turnRecord) {
  const found = await resolve(id);
  if (!found) throw new Error(`cli-sessions: no such session ${id}`);
  const store = await storeFor(id);
  if (!store) throw new Error('cli-sessions: direct-store module unavailable');
  // A CLI session always has wire.jsonl, but guarantee the metadata header so
  // the log stays parseable even if the file was never written.
  const wire = path.join(found.dir, 'agents', 'main', 'wire.jsonl');
  let needsHeader = false;
  try {
    needsHeader = (await fs.stat(wire)).size === 0;
  } catch {
    needsHeader = true;
  }
  if (needsHeader) {
    await fs.mkdir(path.dirname(wire), { recursive: true });
    await fs.writeFile(
      wire,
      JSON.stringify({ type: 'metadata', protocol_version: '1.5', created_at: Date.now() }) + '\n',
      'utf8'
    );
  }
  return store.appendTurn(id, turnRecord);
}

module.exports = {
  list,
  getMessages,
  rename,
  archive,
  appendTurnCompat,
  resolve,
  storeFor,
};
