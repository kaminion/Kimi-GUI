/* usage.js — usage view: daily tokens, account limit cards, session usage.
 *
 * v5 layout: three explicitly labeled sections, each headed by a
 * .usage-section-title plus a one-line .usage-section-desc caption —
 *   1. '오늘 사용량' (#daily-usage)   — this device's token stats (NOT limits)
 *   2. '계정 한도'   (#quota-cards)   — weekly card vs 5-hour card (distinct
 *      colors, reset dates always visible) + extra balance when present
 *   3. '현재 세션'   (#session-usage) — active conversation rows
 * Hover title-tooltips name what each card, row, and chart column measures.
 */
'use strict';

(function () {
  const T = (k, f) => (window.I18N?.t ? window.I18N.t(k, f) : f);

  const CONSOLE_URL = 'https://www.kimi.com/code/console';
  const intFmt = new Intl.NumberFormat('ko-KR');
  const usdFmt = new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
  });

  let currentState = null; // last state passed to render(), for event updates

  /* ---- small DOM helpers ---- */

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function fmtNum(n) {
    return typeof n === 'number' && Number.isFinite(n) ? intFmt.format(n) : '—';
  }

  function ratio(used, limit) {
    return typeof used === 'number' && typeof limit === 'number' && limit > 0
      ? used / limit
      : null;
  }

  /** Contract-styled progress bar; fill width set inline (no extra classes). */
  function progressBar(r) {
    const bar = el('div', 'progress-bar');
    const fill = document.createElement('div');
    fill.style.width = `${Math.max(0, Math.min(100, Math.round((r ?? 0) * 100)))}%`;
    bar.appendChild(fill);
    return bar;
  }

  /** h2 section title + one-line desc caption, in that order. */
  function sectionHead(container, titleKey, titleFallback, descKey, descFallback) {
    container.appendChild(el('h2', 'usage-section-title', T(titleKey, titleFallback)));
    container.appendChild(el('p', 'usage-section-desc', T(descKey, descFallback)));
  }

  /* ---- reset-time formatting (absolute date + relative, per-locale order) ---- */

  const isEn = () => window.I18N?.lang === 'en';

  /** ko '7월 26일 00:17' / en 'Jul 26, 12:17 AM'; null on unparseable input. */
  function fmtResetDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat(
      isEn() ? 'en-US' : 'ko-KR',
      isEn()
        ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
        : { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: false }
    ).format(d);
  }

  /** ko '3일 후' / '2시간 후', en 'in 3 days' / 'in 2 hours'; null when past. */
  function relText(iso) {
    const ms = new Date(iso).getTime() - Date.now();
    if (!Number.isFinite(ms) || ms <= 0) return null;
    const days = Math.round(ms / 86400000);
    if (days >= 1) {
      return isEn() ? `in ${days} ${days === 1 ? 'day' : 'days'}` : `${days}일 후`;
    }
    const hours = Math.max(1, Math.round(ms / 3600000));
    return isEn() ? `in ${hours} ${hours === 1 ? 'hour' : 'hours'}` : `${hours}시간 후`;
  }

  /**
   * Reset meta line: ko '<date> 초기화 (<rel>)' / en 'Resets <date> (<rel>)'.
   * Word order differs per language, so the two orders branch here instead of
   * a template. `key` is usage.weekly.reset / usage.window.reset.
   */
  function resetLine(iso, key) {
    if (typeof iso !== 'string' || !iso) return null;
    const date = fmtResetDate(iso);
    if (!date) return null;
    const rel = relText(iso);
    const relPart = rel ? ` (${rel})` : '';
    return isEn()
      ? `${T(key, '초기화')} ${date}${relPart}`
      : `${date} ${T(key, '초기화')}${relPart}`;
  }

  /* ---- section 2: account limit cards ---- */

  /**
   * One limit card (weekly or 5-hour): colored dot + title, `used / limit`
   * value with the % inlined, 4px bar (color scoped by the card class),
   * reset-date meta line, then the caption explaining what the limit is.
   * `tooltip` becomes the hover title naming what the limit measures.
   */
  function limitCard(cls, title, used, limit, meta, caption, tooltip) {
    const card = el('div', `usage-card limit-card ${cls}`);
    if (tooltip) card.title = tooltip;
    const titleRow = el('div', 'usage-card-title limit-card-title');
    titleRow.appendChild(el('span', 'limit-dot'));
    titleRow.appendChild(document.createTextNode(title));
    card.appendChild(titleRow);

    const r = ratio(used, limit);
    const value = el('div', 'usage-card-value limit-card-value');
    value.appendChild(document.createTextNode(`${fmtNum(used)} / ${fmtNum(limit)}`));
    if (r != null) value.appendChild(el('span', 'limit-card-pct', `${Math.round(r * 100)}%`));
    card.appendChild(value);

    card.appendChild(progressBar(r));
    if (meta) card.appendChild(el('div', 'limit-card-meta', meta));
    card.appendChild(el('div', 'usage-card-caption', caption));
    return card;
  }

  function renderLimitCards(container, quota) {
    const grid = el('div', 'usage-card-grid');
    if (!quota) {
      // Quota undiscoverable: point the user at the web console instead.
      const card = el('div', 'usage-card');
      card.appendChild(el('div', 'usage-card-title', T('usage.account_quota', '계정 할당량')));
      card.appendChild(
        el('div', 'usage-card-value', T('usage.quota_console_hint', 'Kimi Code Console에서 확인할 수 있습니다'))
      );
      const openBtn = el('button', 'usage-open-btn', T('usage.open', '열기'));
      openBtn.type = 'button';
      openBtn.addEventListener('click', () => window.kimi.openExternal(CONSOLE_URL));
      card.appendChild(openBtn);
      grid.appendChild(card);
    } else {
      grid.appendChild(
        limitCard(
          'limit-weekly',
          T('usage.weekly.title', '주간 한도'),
          quota.weeklyUsed,
          quota.weeklyLimit,
          resetLine(quota.resetsAt, 'usage.weekly.reset'),
          T('usage.weekly.desc', '구독 주간 할당량 — 매주 초기화'),
          T('usage.weekly_title', '매주 갱신되는 구독 할당량')
        )
      );
      grid.appendChild(
        limitCard(
          'limit-window',
          T('usage.window.title', '5시간 한도'),
          quota.window5hUsed,
          quota.window5hLimit,
          resetLine(quota.window5hResetsAt, 'usage.window.reset'),
          T('usage.window.desc', '단기 속도 제한 — 사용 시점부터 5시간 롤링'),
          T('usage.window_5h_title', '5시간 단위 요청 속도 제한')
        )
      );
      if (quota.extraBalance != null) {
        const card = el('div', 'usage-card');
        card.title = T('usage.extra_balance_title', '할당량 초과 시 차감되는 추가 잔액');
        card.appendChild(el('div', 'usage-card-title', T('usage.extra_balance', '추가 잔액')));
        card.appendChild(el('div', 'usage-card-value', fmtNum(quota.extraBalance)));
        grid.appendChild(card);
      }
    }
    container.appendChild(grid);
  }

  /* ---- daily usage (v3): today totals + 7-day mini bar chart ---- */

  const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];
  const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function dayLabel(dateStr, isToday) {
    if (isToday) return T('usage.daily.today', '오늘');
    const d = new Date(dateStr + 'T00:00:00'); // local noon-safe parse of YYYY-MM-DD
    const names = window.I18N?.lang === 'en' ? WEEKDAYS_EN : WEEKDAYS_KO;
    return Number.isNaN(d.getTime()) ? dateStr.slice(5) : names[d.getDay()];
  }

  /** One chart column: stacked-height pair of bars + weekday label. */
  function dailyCol(d, max, isToday) {
    const inTok = Number(d?.input_tokens ?? 0) || 0;
    const outTok = Number(d?.output_tokens ?? 0) || 0;
    const col = el('div', 'daily-col');
    const inPct = max > 0 ? Math.round((inTok / max) * 100) : 0;
    const outPct = max > 0 ? Math.round((outTok / max) * 100) : 0;
    const bars = el('div', 'daily-bars');
    const inBar = el('div', 'daily-bar daily-bar-in');
    const outBar = el('div', 'daily-bar daily-bar-out');
    // Zero-data days render as a flat baseline tick instead of a gap.
    inBar.style.height = inTok > 0 ? `${Math.max(inPct, 2)}%` : '0';
    outBar.style.height = outTok > 0 ? `${Math.max(outPct, 2)}%` : '0';
    if (inTok === 0 && outTok === 0) bars.classList.add('empty');
    bars.appendChild(inBar);
    bars.appendChild(outBar);
    col.appendChild(bars);
    col.appendChild(el('div', 'daily-day' + (isToday ? ' today' : ''), dayLabel(d?.date ?? '', isToday)));
    // Hover: exact per-day numbers behind the relative bar heights.
    col.title =
      `${d?.date ?? ''} · ${T('usage.daily.input', '입력')} ${fmtNum(inTok)}` +
      ` · ${T('usage.daily.output', '출력')} ${fmtNum(outTok)}`;
    return col;
  }

  /** Compact limit row for the daily section: dot + label + value + bar + reset meta. */
  function dailyLimitRow(cls, label, used, limit, meta, tooltip) {
    const row = el('div', `daily-limit ${cls}`);
    if (tooltip) row.title = tooltip;
    row.appendChild(el('span', 'limit-dot'));
    row.appendChild(el('span', 'daily-limit-label', label));
    const r = ratio(used, limit);
    const value =
      `${fmtNum(used)} / ${fmtNum(limit)}` + (r != null ? ` (${Math.round(r * 100)}%)` : '');
    row.appendChild(el('span', 'daily-limit-value', value));
    row.appendChild(progressBar(r));
    if (meta) row.appendChild(el('span', 'daily-limit-meta', meta));
    return row;
  }

  /**
   * Section 1 '오늘 사용량', inserted ABOVE the limit cards (created lazily so
   * index.html stays untouched). Hidden entirely when the preload lacks
   * getDailyUsage (older backend) or the fetch fails. v5: today's tokens sit
   * next to compact rows for the account limits they consume (same quota data
   * as section 2, one shared getQuota() promise passed by render()).
   */
  async function renderDaily(quotaPromise) {
    const view = document.getElementById('usage-view');
    if (!view || typeof window.kimi?.getDailyUsage !== 'function') return;
    let box = document.getElementById('daily-usage');
    if (!box) {
      box = el('div', 'daily-usage');
      box.id = 'daily-usage';
      view.insertBefore(box, view.firstChild);
    }
    box.textContent = '';

    let data = null;
    try {
      data = await window.kimi.getDailyUsage();
    } catch (err) {
      console.error('getDailyUsage failed', err);
    }
    const days = Array.isArray(data?.days) ? data.days : [];
    if (!data || days.length === 0) {
      box.hidden = true;
      // Not a rendered section: drop the marker class so no stray divider
      // appears above section 2.
      box.classList.remove('usage-section');
      return;
    }
    box.hidden = false;
    box.classList.add('usage-section');

    sectionHead(
      box,
      'usage.section.daily', '오늘 사용량',
      'usage.daily.desc', '이 기기에서 기록된 토큰 사용량입니다 · 한도가 아닙니다'
    );

    const todayRow = el('div', 'daily-today');
    const today = data.today ?? {};
    const items = [
      [
        T('usage.daily.input_tokens', '입력 토큰'),
        fmtNum(today.input_tokens),
        T('usage.input_tokens_title', '모델에 전달한 토큰 수'),
      ],
      [
        T('usage.daily.output_tokens', '출력 토큰'),
        fmtNum(today.output_tokens),
        T('usage.output_tokens_title', '모델이 생성한 토큰 수'),
      ],
    ];
    if (typeof today.cost_usd === 'number' && Number.isFinite(today.cost_usd)) {
      items.push([
        T('usage.daily.cost', '비용'),
        usdFmt.format(today.cost_usd),
        T('usage.daily.cost_title', '오늘 이 기기에서 기록된 API 비용'),
      ]);
    }
    for (const [label, value, tooltip] of items) {
      const item = el('div', 'daily-today-item');
      if (tooltip) item.title = tooltip;
      item.appendChild(el('span', 'daily-today-value', value));
      item.appendChild(el('span', 'daily-today-label', label));
      todayRow.appendChild(item);
    }
    box.appendChild(todayRow);

    // Compact account-limit rows next to today's tokens (quota shared with
    // section 2 via the caller's promise; hidden when quota is unavailable).
    if (quotaPromise) {
      const quota = await Promise.resolve(quotaPromise).catch(() => null);
      if (quota) {
        const limits = el('div', 'daily-limits');
        limits.appendChild(
          dailyLimitRow(
            'limit-weekly',
            T('usage.weekly.title', '주간 한도'),
            quota.weeklyUsed,
            quota.weeklyLimit,
            resetLine(quota.resetsAt, 'usage.weekly.reset'),
            T('usage.weekly_title', '매주 갱신되는 구독 할당량')
          )
        );
        limits.appendChild(
          dailyLimitRow(
            'limit-window',
            T('usage.window.title', '5시간 한도'),
            quota.window5hUsed,
            quota.window5hLimit,
            resetLine(quota.window5hResetsAt, 'usage.window.reset'),
            T('usage.window_5h_title', '5시간 단위 요청 속도 제한')
          )
        );
        box.appendChild(limits);
      }
    }

    const chart = el('div', 'daily-chart');
    const max = days.reduce(
      (m, d) => Math.max(m, Number(d?.input_tokens ?? 0) || 0, Number(d?.output_tokens ?? 0) || 0),
      0
    );
    days.forEach((d, i) => chart.appendChild(dailyCol(d, max, i === days.length - 1)));
    box.appendChild(chart);

    const legend = el('div', 'daily-legend');
    for (const [swatch, label] of [
      ['daily-swatch-in', T('usage.daily.input', '입력')],
      ['daily-swatch-out', T('usage.daily.output', '출력')],
    ]) {
      const item = el('span', 'daily-legend-item');
      item.appendChild(el('span', `daily-swatch ${swatch}`));
      item.appendChild(document.createTextNode(label));
      legend.appendChild(item);
    }
    box.appendChild(legend);
  }

  /* ---- current-session usage ---- */

  function usageRow(label, value, tooltip) {
    const row = el('div', 'usage-row');
    if (tooltip) row.title = tooltip;
    row.appendChild(el('span', 'usage-row-label', label));
    row.appendChild(el('span', 'usage-row-value', value));
    return row;
  }

  /** Detail block for a session usage object; class .usage-detail for updates. */
  function usageDetail(usage) {
    const box = el('div', 'usage-detail');
    box.appendChild(
      usageRow(
        T('usage.input_tokens', '입력 토큰'),
        fmtNum(usage?.input_tokens),
        T('usage.input_tokens_title', '모델에 전달한 토큰 수')
      )
    );
    box.appendChild(
      usageRow(
        T('usage.output_tokens', '출력 토큰'),
        fmtNum(usage?.output_tokens),
        T('usage.output_tokens_title', '모델이 생성한 토큰 수')
      )
    );
    box.appendChild(
      usageRow(
        T('usage.cache_read_tokens', '캐시 읽기 토큰'),
        fmtNum(usage?.cache_read_tokens),
        T('usage.cache_read_tokens_title', '캐시에서 재사용한 입력 토큰 — 비용이 저렴합니다')
      )
    );
    box.appendChild(
      usageRow(
        T('usage.cache_creation_tokens', '캐시 생성 토큰'),
        fmtNum(usage?.cache_creation_tokens),
        T('usage.cache_creation_tokens_title', '후속 재사용을 위해 캐시에 저장한 토큰')
      )
    );
    box.appendChild(
      usageRow(
        T('usage.total_cost', '총 비용'),
        typeof usage?.total_cost_usd === 'number' ? usdFmt.format(usage.total_cost_usd) : '—',
        T('usage.total_cost_title', '이 세션의 누적 API 비용')
      )
    );
    box.appendChild(
      usageRow(
        T('usage.turns', '턴 수'),
        fmtNum(usage?.turn_count),
        T('usage.turns_title', '완료된 응답 횟수')
      )
    );

    const limit = Number(usage?.context_limit ?? 0);
    const used = Number(usage?.context_tokens ?? 0);
    const ctx = el('div', 'usage-context');
    ctx.title = T('usage.context_window_title', '현재 대화가 모델에 전달하는 토큰 비율');
    ctx.appendChild(el('div', 'usage-card-title', T('usage.context_window', '컨텍스트 윈도우')));
    ctx.appendChild(
      el(
        'div',
        'usage-card-value',
        limit > 0
          ? `${intFmt.format(used)} / ${intFmt.format(limit)}` +
            T('common.tokens', ' 토큰') +
            ` (${Math.round((used / limit) * 100)}%)`
          : '—'
      )
    );
    if (limit > 0) ctx.appendChild(progressBar(used / limit));
    box.appendChild(ctx);
    return box;
  }

  function renderSessionUsage(container, state) {
    if (!state?.activeId) {
      container.appendChild(
        el('p', 'usage-empty', T('usage.no_session', '선택된 세션이 없습니다. 대화를 시작하면 이곳에 사용량이 표시됩니다.'))
      );
      return;
    }
    // Rendered asynchronously by render(); placeholder until the profile arrives.
    container.appendChild(el('p', 'usage-empty', T('common.loading', '불러오는 중…')));
  }

  /* ---- public API ---- */

  /** Full render: daily stats + limit cards + active session usage. Called when the view shows. */
  async function render(state) {
    currentState = state;
    const quotaBox = document.getElementById('quota-cards');
    const sessionBox = document.getElementById('session-usage');
    if (!quotaBox || !sessionBox) return;
    quotaBox.textContent = '';
    sessionBox.textContent = '';
    quotaBox.classList.add('usage-section');
    sessionBox.classList.add('usage-section');
    // One getQuota() call per render feeds the section-2 limit cards.
    const quotaPromise = Promise.resolve()
      .then(() => window.kimi.getQuota())
      .catch((err) => {
        console.error('getQuota failed', err);
        return null;
      });
    void renderDaily(quotaPromise); // section 1 above the limit cards; no need to block on it
    sectionHead(
      quotaBox,
      'usage.section.limits', '계정 한도',
      'usage.limits.desc', '이 계정에 적용되는 구독 한도입니다'
    );
    sectionHead(
      sessionBox,
      'usage.section.session', '현재 세션',
      'usage.session.desc', '선택된 대화의 토큰 사용량입니다'
    );
    renderSessionUsage(sessionBox, state);

    const quota = await quotaPromise;
    renderLimitCards(quotaBox, quota);

    const activeId = state?.activeId;
    if (activeId) {
      try {
        const profile = await window.kimi.getProfile(activeId);
        if (activeId !== currentState?.activeId) return; // view state changed mid-fetch
        updateUsage(activeId, profile?.usage);
      } catch (err) {
        console.error('getProfile failed', err);
        const placeholder = sessionBox.querySelector('.usage-empty');
        if (placeholder) placeholder.textContent = T('usage.load_failed', '사용량 정보를 불러올 수 없습니다.');
      }
    }
  }

  /** In-place update from a 'usage' push event (or after a profile fetch). */
  function updateUsage(sessionId, usage) {
    if (!usage || sessionId !== currentState?.activeId) return;
    const sessionBox = document.getElementById('session-usage');
    if (!sessionBox) return;
    const detail = usageDetail(usage);
    const old = sessionBox.querySelector('.usage-detail');
    if (old) old.replaceWith(detail);
    else {
      sessionBox.querySelector('.usage-empty')?.remove();
      sessionBox.appendChild(detail);
    }
  }

  // Language change: re-render only when the usage view is visible.
  window.I18N?.onChange?.(() => {
    if (window.App?.state?.view === 'usage' && currentState) void render(currentState);
  });

  window.Usage = { render, updateUsage };
})();
