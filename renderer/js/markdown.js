/* markdown.js — strict, safe markdown rendering for the transcript.
 * Exposes window.Markdown2.render(text) -> sanitized HTML string.
 *
 * Pipeline: marked.parse -> DOM sanitize (allowlist tags/attrs; raw HTML is
 * re-escaped to visible text, never interpreted) -> enhance (hljs highlighting,
 * code header bar with copy button, external-link wiring).
 * Depends on window.marked / window.hljs loaded before this file (both optional:
 * the renderer degrades to escaped plain text when they are missing).
 */
(function () {
  'use strict';

  const T = (k, f) => (window.I18N?.t ? window.I18N.t(k, f) : f);

  // Tags GitHub-style markdown may legitimately produce. Everything else is escaped.
  const ALLOWED_TAGS = new Set([
    'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
    'em', 'strong', 'del', 'a', 'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'input', 'sup', 'sub',
  ]);

  // Configured marked instance (GFM, single \n -> <br> like chat apps expect).
  let markedInstance = null;
  function getMarked() {
    if (markedInstance || !window.marked) return markedInstance;
    try {
      if (typeof window.marked.Marked === 'function') {
        markedInstance = new window.marked.Marked({ gfm: true, breaks: true });
      } else if (typeof window.marked.parse === 'function') {
        window.marked.setOptions?.({ gfm: true, breaks: true });
        markedInstance = window.marked;
      }
    } catch {
      markedInstance = window.marked;
    }
    return markedInstance;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // URL protocol guard: strip whitespace/control chars before testing.
  function isSafeUrl(raw, allowDataImage) {
    if (typeof raw !== 'string') return false;
    const v = raw.replace(/[\s\u0000-\u001F]+/g, '');
    if (/^(https?:|mailto:)/i.test(v)) return true;
    if (allowDataImage && /^data:image\//i.test(v)) return true;
    return false;
  }

  function scrubAttrs(el, tag) {
    const keep = new Set();
    if (tag === 'a') keep.add('href');
    if (tag === 'img') { keep.add('src'); keep.add('alt'); }
    if (tag === 'code' || tag === 'pre') keep.add('class');
    if (tag === 'td' || tag === 'th') { keep.add('colspan'); keep.add('rowspan'); keep.add('align'); }
    if (tag === 'input') { keep.add('type'); keep.add('checked'); keep.add('disabled'); }
    for (const attr of Array.from(el.attributes)) {
      if (!keep.has(attr.name)) el.removeAttribute(attr.name);
    }
    if (tag === 'a') {
      if (!isSafeUrl(el.getAttribute('href') || '', false)) {
        el.removeAttribute('href');
      } else {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      }
    }
    if (tag === 'img') {
      if (!isSafeUrl(el.getAttribute('src') || '', true)) {
        el.replaceWith(document.createTextNode(el.getAttribute('alt') || ''));
        return;
      }
      el.setAttribute('loading', 'lazy');
    }
    if (tag === 'input') {
      // GFM task-list checkboxes: display only.
      if ((el.getAttribute('type') || '').toLowerCase() !== 'checkbox') {
        el.remove();
        return;
      }
      el.setAttribute('disabled', '');
      el.setAttribute('tabindex', '-1');
    }
  }

  // Recursively sanitize: disallowed tags become visible escaped text (contract:
  // no raw HTML), allowed tags get their attributes scrubbed.
  function sanitizeChildren(root) {
    for (const child of Array.from(root.childNodes)) {
      if (child.nodeType === 8) { child.remove(); continue; } // drop comments
      if (child.nodeType !== 1) continue; // text nodes are safe
      const tag = child.tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) {
        child.replaceWith(document.createTextNode(child.outerHTML));
        continue;
      }
      scrubAttrs(child, tag);
      sanitizeChildren(child);
    }
  }

  // Add hljs highlighting + header bar (language label + copy button) to each block.
  function enhanceCodeBlocks(root) {
    for (const pre of Array.from(root.querySelectorAll('pre'))) {
      const code = pre.querySelector('code');
      const rawText = (code || pre).textContent || '';
      const cls = (code && code.className) || '';
      const m = /language-([A-Za-z0-9_+.#-]+)/.exec(cls);
      const lang = m ? m[1] : '';
      if (code && lang && window.hljs && typeof window.hljs.getLanguage === 'function') {
        try {
          if (window.hljs.getLanguage(lang)) {
            code.innerHTML = window.hljs.highlight(rawText, { language: lang }).value;
            code.classList.add('hljs');
          }
        } catch { /* unknown grammar: leave plain */ }
      }
      const wrap = document.createElement('div');
      wrap.className = 'code-block';
      const header = document.createElement('div');
      header.className = 'code-header';
      const label = document.createElement('span');
      label.className = 'code-lang';
      label.textContent = lang || 'text';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'code-copy-btn';
      btn.textContent = T('markdown.copy', '복사');
      header.append(label, btn);
      pre.parentNode.replaceChild(wrap, pre);
      wrap.append(header, pre);
    }
  }

  function render(text) {
    if (text == null) return '';
    const src = String(text);
    const mk = getMarked();
    let html;
    if (mk && typeof mk.parse === 'function') {
      try {
        html = mk.parse(src, { async: false });
      } catch {
        html = '<p>' + escapeHtml(src) + '</p>';
      }
    } else {
      // Fallback without marked: escaped text, line breaks preserved.
      html = '<p>' + escapeHtml(src).replace(/\n/g, '<br>') + '</p>';
    }
    if (typeof html !== 'string') html = String(html ?? '');
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    sanitizeChildren(tpl.content);
    enhanceCodeBlocks(tpl.content);
    return tpl.innerHTML;
  }

  // One delegated click listener covers dynamically injected content:
  // - .code-copy-btn: copy the block's text via navigator.clipboard.
  // - .md a[href]: route external links through window.kimi.openExternal.
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    const copyBtn = t.closest('.code-copy-btn');
    if (copyBtn) {
      const block = copyBtn.closest('.code-block');
      const pre = block && block.querySelector('pre');
      const text = pre ? pre.textContent || '' : '';
      if (navigator.clipboard && text) {
        navigator.clipboard.writeText(text).then(() => {
          const prev = copyBtn.textContent;
          copyBtn.textContent = T('markdown.copied', '복사됨');
          copyBtn.disabled = true;
          setTimeout(() => { copyBtn.textContent = prev; copyBtn.disabled = false; }, 1200);
        }).catch(() => { /* clipboard unavailable: no-op */ });
      }
      return;
    }
    const a = t.closest('.md a[href]');
    if (a) {
      const href = a.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href)) {
        e.preventDefault();
        if (window.kimi && typeof window.kimi.openExternal === 'function') {
          window.kimi.openExternal(href);
        }
      }
    }
  });

  window.Markdown2 = { render, escapeHtml };
})();
