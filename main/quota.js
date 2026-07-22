'use strict';

// Account-level quota for the managed Kimi Code provider.
// Mirrors the TUI `/usage` slash command: GET <base>/usages with the stored
// OAuth access token. Best-effort: returns null on any failure so the UI can
// degrade to per-session usage. Never logs tokens or response bodies.

const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const DEFAULT_BASE_URL = 'https://api.kimi.com/coding/v1';
const REQUEST_TIMEOUT_MS = 8000; // same timeout the CLI uses for this call
const EXPIRY_SKEW_MS = 60 * 1000; // treat tokens expiring within 60s as expired
const FIXED_POINT_CENTS = 1e6; // booster wallet amounts: 1e6 units = 1 cent
const WINDOW_5H_MINUTES = 300; // rolling 5-hour window = 300 minutes

function kimiHome() {
  const home = process.env.KIMI_CODE_HOME;
  return home && home.trim() ? home.trim() : path.join(os.homedir(), '.kimi-code');
}

function managedBaseUrl() {
  const url = process.env.KIMI_CODE_BASE_URL;
  return (url && url.trim() ? url.trim() : DEFAULT_BASE_URL).replace(/\/+$/, '');
}

// The CLI accepts both numbers and numeric strings (the API sends "65").
function toInt(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  return null;
}

function toIsoTime(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// Read the freshest stored OAuth access token. The CLI/TUI refreshes and
// rewrites this file on its own runs, so re-read on every call. Refresh is
// out of scope here: an expired (or revoked-tombstone) token yields null.
async function readStoredAccessToken() {
  let raw;
  try {
    raw = await fs.readFile(path.join(kimiHome(), 'credentials', 'kimi-code.json'), 'utf8');
  } catch {
    return null; // not logged in via OAuth (or custom home)
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const token = data.access_token ?? data.accessToken;
  if (typeof token !== 'string' || token.length === 0) return null; // missing or revoked
  const expiresAt = toInt(data.expires_at ?? data.expiresAt);
  if (expiresAt !== null) {
    // Stored as unix seconds; tolerate milliseconds defensively.
    const ms = expiresAt > 1e12 ? expiresAt : expiresAt * 1000;
    if (ms - EXPIRY_SKEW_MS <= Date.now()) return null;
  }
  return token;
}

// A usage record: { limit, used | remaining, resetTime }. `used` falls back
// to limit - remaining, exactly like the CLI's parser.
function parseUsageRow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const limit = toInt(raw.limit);
  let used = toInt(raw.used);
  if (used === null) {
    const remaining = toInt(raw.remaining);
    if (remaining !== null && limit !== null) used = limit - remaining;
  }
  if (used === null && limit === null) return null;
  const resetsAt = toIsoTime(raw.resetTime ?? raw.reset_at ?? raw.resetAt ?? raw.reset_time);
  return { used: used ?? 0, limit: limit ?? 0, resetsAt };
}

// Pick the rolling 5-hour entry from the `limits` array by its window
// (300 minutes / 5 hours), the same way the TUI labels it "5h limit".
function parseWindow5h(limits) {
  if (!Array.isArray(limits)) return null;
  for (const item of limits) {
    if (!item || typeof item !== 'object') continue;
    const win = item.window && typeof item.window === 'object' ? item.window : {};
    const duration = toInt(win.duration ?? item.duration);
    const rawUnit = win.timeUnit ?? item.timeUnit;
    const unit = typeof rawUnit === 'string' ? rawUnit : '';
    const is5h =
      (unit.includes('MINUTE') && duration === WINDOW_5H_MINUTES) ||
      (unit.includes('HOUR') && duration === WINDOW_5H_MINUTES / 60);
    if (is5h) return parseUsageRow(item.detail ?? item);
  }
  return null;
}

// Extra-usage ("booster") wallet -> balance in whole cents, like the CLI:
// amounts are fixed-point with 1e6 units per cent.
function parseExtraBalanceCents(wallet) {
  if (!wallet || typeof wallet !== 'object') return null;
  const balance = wallet.balance;
  if (!balance || typeof balance !== 'object' || balance.type !== 'BOOSTER') return null;
  const left = toInt(balance.amountLeft);
  if (left === null || left < 0) return null;
  const cents = left / FIXED_POINT_CENTS;
  return cents > 0 && cents < 1 ? 1 : Math.round(cents);
}

/**
 * Fetch account quota from the managed backend.
 * @param {{ token?: string }} [opts] token: OAuth access token override
 *   (mainly for tests); when omitted, read from ~/.kimi-code/credentials.
 * @returns {Promise<{
 *   weeklyUsed: number, weeklyLimit: number,
 *   window5hUsed: number|null, window5hLimit: number|null,
 *   extraBalance?: number, resetsAt?: string, window5hResetsAt?: string
 * } | null>} quota units are plan points (observed limit normalized to 100);
 *   extraBalance is whole cents; resetsAt fields are ISO 8601. null on any
 *   failure (logged out, token expired, endpoint unavailable, bad payload).
 */
async function getQuota(opts = {}) {
  const token = typeof opts.token === 'string' && opts.token.length > 0
    ? opts.token
    : await readStoredAccessToken();
  if (!token) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${managedBaseUrl()}/usages`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch {
    return null; // offline, DNS, timeout
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) return null; // 401 expired/revoked, 404 endpoint unavailable

  let payload;
  try {
    payload = await res.json();
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;

  const weekly = parseUsageRow(payload.usage);
  if (!weekly) return null; // payload shape not recognized — degrade safely
  const window5h = parseWindow5h(payload.limits);
  const extraBalance = parseExtraBalanceCents(payload.boosterWallet);

  const quota = {
    weeklyUsed: weekly.used,
    weeklyLimit: weekly.limit,
    window5hUsed: window5h ? window5h.used : null,
    window5hLimit: window5h ? window5h.limit : null,
  };
  if (extraBalance !== null) quota.extraBalance = extraBalance;
  if (weekly.resetsAt) quota.resetsAt = weekly.resetsAt;
  if (window5h && window5h.resetsAt) quota.window5hResetsAt = window5h.resetsAt;
  return quota;
}

module.exports = { getQuota };
