# Account Quota (`main/quota.js`)

Best-effort fetch of the **account-level plan quota** — the same data the TUI
`/usage` slash command shows as "Plan usage" (weekly quota + rolling 5-hour
window + optional extra-usage balance). This is *not* the per-session token
usage that `GET /sessions/{id}/profile` provides.

## Discovery summary (how this was found)

- The managed provider base URL is `https://api.kimi.com/coding/v1`
  (binary string `DEFAULT_KIMI_CODE_BASE_URL`, overridable via the
  `KIMI_CODE_BASE_URL` env var).
- The quota endpoint is `GET <base>/usages`, found in the binary next to the
  TUI usage-panel code (`fetchManagedUsage`). Verified live: HTTP 200 with the
  stored OAuth access token as `Authorization: Bearer <token>`,
  `Accept: application/json`.
- OAuth credentials live at `~/.kimi-code/credentials/kimi-code.json`
  (mode 0600), **not** under `~/.kimi-code/oauth/` (that dir only holds an
  empty marker file on this machine). File shape:

  ```json
  { "access_token": "…", "refresh_token": "…", "expires_at": 1784686268,
    "scope": "kimi-code", "token_type": "Bearer", "expires_in": 3600 }
  ```

  `expires_at` is a unix timestamp in **seconds**. An empty `access_token` is
  a revoked tombstone. `KIMI_CODE_HOME` relocates the `~/.kimi-code` root.
- **Token refresh is out of scope.** The CLI/TUI refreshes and rewrites the
  credentials file on its own runs; `quota.js` re-reads the file on every
  call so it always uses the freshest token. If the token is expired (60 s
  skew) or revoked, `getQuota()` returns `null`.

## API response shape (verified 2026-07-22)

```json
{
  "user":  { "userId": "…", "region": "REGION_OVERSEA",
             "membership": { "level": "LEVEL_STANDARD" } },
  "usage": { "limit": "100", "used": "65", "remaining": "35",
             "resetTime": "2026-07-26T00:17:28.963553Z" },
  "limits": [
    { "window": { "duration": 300, "timeUnit": "TIME_UNIT_MINUTE" },
      "detail": { "limit": "100", "used": "3", "remaining": "97",
                  "resetTime": "2026-07-22T03:17:28.963553Z" } }
  ],
  "boosterWallet": { "balance": { "type": "BOOSTER", "amount": "…",
                     "amountLeft": "…" }, "monthlyUsed": { "priceInCents": 0,
                     "currency": "USD" }, … }
}
```

Notes:

- Numbers arrive as **numeric strings**; both are accepted.
- `usage` is the **weekly** quota; `limits[]` entries are rate windows. The
  5-hour rolling window is the entry with `window.duration = 300` +
  `timeUnit` containing `MINUTE` (equivalently 5 + `HOUR`). The TUI labels it
  "5h limit".
- `boosterWallet` is absent on accounts without extra usage. Its
  `balance.amountLeft` is a **fixed-point amount: 1 000 000 units = 1 cent**
  (binary constant `FIXED_POINT_CENTS = 1e6`); the CLI converts with
  `round(amountLeft / 1e6)` (min 1 when > 0).

### Units

`weeklyUsed/weeklyLimit` and `window5hUsed/window5hLimit` are **unit-less plan
quota points**. On every observed account the backend normalizes `limit` to
`100`, making `used` effectively a percentage of the plan quota; the TUI only
ever renders the `used / limit` ratio as a percent bar, never the raw numbers.
Treat the raw values as opaque — display the ratio.

## Normalized return value

```js
getQuota({ token? }) -> {
  weeklyUsed: number,        // quota points used this week
  weeklyLimit: number,       // weekly quota points (observed: 100)
  window5hUsed: number|null, // quota points used in the rolling 5h window
  window5hLimit: number|null,// 5h window quota points; null when not reported
  extraBalance?: number,     // extra-usage balance, whole cents (USD unless
                             //   the wallet says otherwise); omitted when none
  resetsAt?: string,         // weekly reset, ISO 8601
  window5hResetsAt?: string  // 5h window reset, ISO 8601
} | null
```

`{ token }` is an optional access-token override (used by tests); production
callers just call `getQuota()`.

## Failure model

`null` is returned — never an exception, never a logged secret — when:

- the credentials file is missing / malformed / revoked (empty token),
- the access token is expired (refresh is the CLI's job, not ours),
- the request fails, times out (8 s, same as the CLI), or returns non-200
  (401 = unauthorized, 404 = endpoint unavailable for this provider),
- the payload doesn't contain a recognizable weekly `usage` record.

The usage view must therefore degrade gracefully: show per-session usage from
`GET /sessions/{id}/profile` plus a link to the Kimi Code Console, and only
render quota cards when `getQuota()` returns data.

## Dead ends / notes for the curious

- `~/.kimi-code/oauth/` contains only a 0-byte marker; the real tokens are in
  `credentials/kimi-code.json`.
- Grep targets that led nowhere: `/quota`, `/billing`, `/subscription`,
  `/rate_limit` paths don't exist; the only account-quota route is `/usages`.
- The local `kimi web` server (docs/ref/openapi.json) exposes **per-session**
  usage only — no account quota passthrough exists there.
