# Kimi Desktop — Design System

Apple-HIG design system for the Kimi Desktop chat UI. Implemented in three
stylesheets, loaded in this order (no bundler, plain `<link>` tags):

1. `renderer/styles/base.css` — tokens, reset, focus rings, scrollbars
2. `renderer/styles/layout.css` — window chrome and view structure
3. `renderer/styles/components.css` — messages, markdown, buttons, modals, cards

UI copy is Korean (owned by the JS agents); the CSS itself contains no
user-visible strings.

## Tokens (`base.css`)

Contract-fixed custom properties on `:root` (light) with overrides in
`@media (prefers-color-scheme: dark)`:

| Token | Light | Dark |
| --- | --- | --- |
| `--bg` | `#ffffff` | `#1d1d1f` |
| `--bg-secondary` | `#f5f5f7` | `#2c2c2e` |
| `--sidebar-bg` | `rgba(246,246,248,.8)` | `rgba(30,30,32,.72)` |
| `--text` | `#1d1d1f` | `#f5f5f7` |
| `--text-secondary` | `#6e6e73` | `#a1a1a6` |
| `--text-dim` | `#86868b` | `#6e6e73` |
| `--accent` | `#007aff` | `#0a84ff` |
| `--accent-text` | `#ffffff` | `#ffffff` |
| `--border` | `rgba(0,0,0,.10)` | `rgba(255,255,255,.12)` |
| `--danger` | `#ff3b30` | `#ff453a` |
| `--success` | `#34c759` | `#30d158` |
| `--warn` | `#ff9500` | `#ff9f0a` |
| `--code-bg` | `#f5f5f7` | `#2c2c2e` |
| `--radius-l` / `--radius-m` / `--radius-s` | `10px` / `8px` / `6px` | same |
| `--font-ui` | `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", …` | same |
| `--font-mono` | `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, …` | same |

### Added tokens (not in the contract, safe to use in JS-injected markup)

- Spacing scale on the 8pt grid: `--space-1:4px` (the sanctioned half-step),
  `--space-2:8px`, `--space-3:16px`, `--space-4:24px`, `--space-5:32px`,
  `--space-6:48px`.
- `--radius-xl: 12px` (composer card, usage cards).
- `--accent-soft`, `--hover-bg`, `--active-bg`, `--danger-soft` — translucent
  state fills that work over any background.
- `--header-bg` — translucent chat-header fill (matches `--bg` at 80%).
- `--selection-bg`, `--scrollbar-thumb`.
- `--shadow-card` (composer), `--shadow-modal` (dialogs). No gradients anywhere.
- Metrics: `--titlebar-h: 34px`, `--sidebar-w: 260px`.

## Type & rhythm

- 13px base UI font, line-height 1.4. Content text (`.md`, `#composer`,
  `.msg-user`) is 14px for readability; metadata is 11–12px; code is 12px mono.
- Heading scale in `.md`: 20 / 17 / 15 / 13, weight 600.
- Numbers that change live (usage values, context meter) use
  `font-variant-numeric: tabular-nums`.
- Vertical rhythm: 16px between transcript blocks, 32px before a new user
  turn, 8px between consecutive tool rows. Transcript column is
  `max-width: 760px`, centered; usage grid is `max-width: 960px`.

## Layout decisions

- `#titlebar` is an in-flow 34px full-width drag strip with `padding-left: 78px`
  so the macOS traffic lights never cover sidebar content. Interactive elements
  inside it must re-add `-webkit-app-region: no-drag` (rule already present).
- `#sidebar` is translucent (`--sidebar-bg` + `backdrop-filter: saturate(180%)
  blur(20px)`) with a 0.5px right hairline. Session items: 8px radius,
  hover → `--hover-bg`, `.active` → `--active-bg`, `.busy` → pulsing accent dot
  via `::after` (keyframe `busy-pulse`), titles clamp to 2 lines.
- `#chat-header` is 48px, translucent with blur and a bottom hairline;
  `#chat-title` flexes and truncates, metadata pills sit on the trailing edge.
- `#composer-wrap` is a floating card: 12px radius, 0.5px border, subtle
  `--shadow-card`, centered at `max-width: 760px` with 16px bottom margin.
  `:focus-within` moves the accent ring to the card (textarea itself has no
  outline). The textarea auto-grows via JS and scrolls past `max-height: 160px`.
- `#usage-view` is a scrollable grid: `repeat(auto-fit, minmax(220px, 1fr))`
  of `.usage-card`s plus the `#session-usage` table card below.
- `[hidden]` carries `display: none !important` in the reset so toggling the
  attribute on `#chat-view` / `#usage-view` / `#abort-btn` always wins.

## Component DOM hooks (for chat/shell agents)

The contract fixes the outer classes; these inner hooks are what the CSS
expects (reconcile here if your markup differs):

```html
<!-- Tool row; toggle .expanded on click; state class is running|done|error -->
<div class="msg-tool running">
  <div class="msg-tool-header">
    <span class="tool-status"></span>   <!-- glyph via CSS mask, keep empty -->
    <span class="tool-chevron"></span>  <!-- glyph via CSS mask, keep empty -->
    <span class="tool-name">Bash</span>
    <span class="tool-summary">ls -la</span>
  </div>
  <div class="msg-tool-body">…mono output…</div>
</div>

<!-- Thinking; 3-line clamp until .expanded -->
<div class="msg-thinking"><div class="msg-thinking-body">…</div></div>

<!-- Code block emitted by markdown.js (bare .md > pre is also styled) -->
<div class="code-block">
  <div class="code-block-header">
    <span class="code-lang">python</span>
    <button class="code-copy-btn">복사</button>
  </div>
  <pre><code class="hljs language-python">…</code></pre>
</div>

<!-- Approval / question modal inside #modal-root -->
<div class="modal-backdrop">
  <div class="modal">
    <div class="modal-title">…</div>
    <div class="modal-body">… <pre>…command…</pre> <input type="text"> …</div>
    <div class="modal-actions">
      <button class="btn">거절</button>
      <button class="btn-primary">승인</button>
    </div>
  </div>
</div>

<!-- Usage card (contract-fixed children) + optional .usage-card-sub line -->
<div class="usage-card">
  <div class="usage-card-title">주간 사용량</div>
  <div class="usage-card-value">42%</div>
  <div class="progress-bar"><div class="progress-fill" style="width:42%"></div></div>
</div>
```

Notes:

- `.progress-bar` styles its first child as the fill even without
  `.progress-fill`, so `<div class="progress-bar"><div style="width:42%">`
  works. Optional modifiers `.warn` / `.crit` recolor the fill.
- `#model-label` / `#context-meter` carry the pill look directly by id, so no
  extra class is needed; `.badge` / `.pill` exist for anything else.
- A minimal Xcode-ish `.hljs` token theme (light + dark) ships in
  `components.css`, so no vendor highlight theme CSS is required. It does not
  collide with a vendor theme if the shell agent decides to link one anyway.
- `#send-btn` draws its arrow via CSS mask — leave the button empty in HTML.
  If an inline `<svg>` is ever added, the CSS arrow hides via `:has(svg)`.
- All glyphs (chevron, status check/x, spinner, send arrow) are CSS masks or
  borders — no emoji, no image assets, all tint via tokens.
- Buttons use `cursor: default` per macOS convention (no hand cursor).
- `prefers-reduced-motion` collapses all animations/transitions.

## Icon

`assets/icon.svg` is the source: a black rounded square (rx=229) with a white
terminal chevron and an accent-blue (`#0A84FF`) block cursor.
`assets/icon.png` (1024×1024) is rendered from the same geometry by
`assets/make_icon.py` (Pillow, 4× supersampling + LANCZOS) — re-run
`python3 assets/make_icon.py` after editing the SVG.

## Cross-platform

- Font stack falls back to Segoe UI / Malgun Gothic on Windows; translucent
  surfaces degrade gracefully without vibrancy (they sit over `--bg`).
- Scrollbars: 8px `::-webkit-scrollbar` with rounded thumb, transparent track
  (plus `scrollbar-width: thin` for completeness).
- All borders are 0.5–1px token-based hairlines; everything interactive has
  `:hover` / `:active` states and `:focus-visible` gets a 2px accent ring.
