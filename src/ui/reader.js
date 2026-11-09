// In-browser reader for a converted book (no EPUB needed).
//
// Privacy: the book is rendered from memory with DOM text nodes (never
// innerHTML), nothing is uploaded, and nothing of the text is stored. Only
// display settings and the reading position (chapter + paragraph number,
// keyed by a hash of the file) are kept in localStorage, so reopening the
// same file resumes where you left off.
//
// Two layouts: "pages" (CSS multi-column pagination; tap the edges, swipe or
// use the arrow keys; two pages side by side on wide screens) and "scroll".

import { dashSegments } from '../core/typography.js';

const SETTINGS_KEY = 'mr-reader-settings';
const POS_PREFIX = 'mr-pos-';
const DEFAULTS = { size: 100, font: 'serif', theme: 'auto', spacing: 1.55, layout: 'pages', justify: true };
const SIZES = [80, 90, 100, 112, 125, 140, 160, 185, 210];

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: fine */ }
  },
};

/** Short, non-reversible id of a file, to remember the reading position. */
export async function fileKey(bytes) {
  try {
    const d = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    let h = 2166136261; // FNV-1a fallback (no WebCrypto on insecure origins)
    for (let i = 0; i < bytes.length; i += Math.max(1, bytes.length >> 16)) h = Math.imul(h ^ bytes[i], 16777619);
    return `f${(h >>> 0).toString(16)}${bytes.length.toString(16)}`;
  }
}

const el = (tag, props = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  e.append(...children.filter((c) => c != null));
  return e;
};

function runsToNodes(runs, onNote) {
  const out = [];
  for (const r of runs) {
    if (r.br) { out.push(el('br')); continue; }
    if (r.n !== undefined) {
      out.push(el('button', { type: 'button', class: 'r-noteref', 'aria-label': `Note ${r.n}`, 'data-n': r.n, onclick: (e) => { e.stopPropagation(); onNote(r.n); } }, String(r.n)));
      continue;
    }
    if (r.t === undefined) continue;
    let node = document.createDocumentFragment();
    for (const [t, nowrap] of dashSegments(r.t)) node.append(nowrap ? el('span', { class: 'r-nw' }, t) : document.createTextNode(t));
    if (r.sup) node = el('sup', {}, node);
    if (r.b) node = el('b', {}, node);
    if (r.i) node = el('i', {}, node);
    out.push(node);
  }
  return out;
}

class Reader {
  constructor() {
    this.settings = { ...DEFAULTS, ...store.get(SETTINGS_KEY, {}) };
    this.book = null;
    this.chapter = 0;
    this.page = 0;
    this.pages = 1;
    this.build();
  }

  build() {
    const btn = (label, icon, onclick, extra = {}) => el('button', { type: 'button', class: 'r-btn', 'aria-label': label, title: label, onclick, ...extra }, icon);
    this.titleEl = el('div', { class: 'r-title' });
    this.content = el('article', { class: 'r-content' });
    this.viewport = el('div', { class: 'r-viewport', tabindex: '-1' }, this.content);
    this.progress = el('div', { class: 'r-progress', 'aria-live': 'polite' });
    this.prevBtn = btn('Previous page', '‹', () => this.prev(), { class: 'r-btn r-turn' });
    this.nextBtn = btn('Next page', '›', () => this.next(), { class: 'r-btn r-turn' });
    this.tocList = el('ol', { class: 'r-toc' });
    this.drawer = el('nav', { class: 'r-drawer', 'aria-label': 'Contents', hidden: true },
      el('div', { class: 'r-panel-head' }, el('strong', { text: 'Contents' }), btn('Close contents', '✕', () => this.togglePanel(null))),
      this.tocList);
    this.settingsPanel = el('div', { class: 'r-settings', role: 'dialog', 'aria-label': 'Display settings', hidden: true });
    this.notePanel = el('div', { class: 'r-note', role: 'dialog', 'aria-label': 'Note', hidden: true });
    this.root = el('div', { id: 'reader', class: 'reader', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Reader', hidden: true },
      el('header', { class: 'r-bar r-top' },
        btn('Close reader', '✕', () => this.requestClose(), { id: 'reader-close' }),
        this.titleEl,
        btn('Contents', '☰', () => this.togglePanel(this.drawer), { id: 'reader-toc' }),
        btn('Display settings', 'Aa', () => this.togglePanel(this.settingsPanel), { id: 'reader-settings' })),
      this.viewport,
      el('footer', { class: 'r-bar r-bottom' }, this.prevBtn, this.progress, this.nextBtn),
      this.drawer, this.settingsPanel, this.notePanel);
    document.body.append(this.root);
    this.buildSettings();

    // Gestures on the page area: tap edges or swipe to turn pages.
    let start = null;
    this.viewport.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY, t: Date.now() }; });
    this.viewport.addEventListener('pointerup', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      const s = start; start = null;
      if (e.target.closest('button, a')) return;
      if (String(window.getSelection?.() || '').length) return; // selecting text
      if (this.closePanels()) return;
      if (this.settings.layout !== 'pages') return;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - s.t < 800) {
        if (dx < 0) this.next(); else this.prev();
        return;
      }
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
        const r = this.viewport.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        if (x < 0.3) this.prev();
        else if (x > 0.7) this.next();
      }
    });
    this.viewport.addEventListener('scroll', () => {
      if (this.settings.layout === 'scroll') { clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => { this.savePosition(); this.updateProgress(); }, 250); }
    }, { passive: true });
    document.addEventListener('keydown', (e) => this.onKey(e));
    new ResizeObserver(() => this.relayout()).observe(this.viewport);
    window.addEventListener('popstate', () => { if (!this.root.hidden && history.state?.reader !== true) this.close(); });
  }

  buildSettings() {
    const s = this.settings;
    const group = (label, name, options) => el('fieldset', { class: 'r-group' }, el('legend', { text: label }),
      ...options.map(([value, text]) => el('label', { class: 'r-choice' },
        el('input', { type: 'radio', name, value, checked: String(s[name]) === String(value), onchange: () => this.set(name, typeof DEFAULTS[name] === 'number' ? Number(value) : value) }),
        el('span', { text }))));
    const sizeOut = el('output', { class: 'r-size', text: `${s.size}%` });
    const sizeBtn = (d, label) => el('button', { type: 'button', class: 'r-btn', 'aria-label': label, onclick: () => {
      const i = SIZES.indexOf(this.settings.size);
      const next = SIZES[Math.min(SIZES.length - 1, Math.max(0, (i < 0 ? 2 : i) + d))];
      this.set('size', next);
      sizeOut.textContent = `${next}%`;
    } }, d < 0 ? 'A−' : 'A+');
    this.settingsPanel.replaceChildren(
      el('div', { class: 'r-panel-head' }, el('strong', { text: 'Display' }), el('button', { type: 'button', class: 'r-btn', 'aria-label': 'Close settings', onclick: () => this.togglePanel(null) }, '✕')),
      el('div', { class: 'r-group r-sizes' }, sizeBtn(-1, 'Smaller text'), sizeOut, sizeBtn(1, 'Larger text')),
      group('Layout', 'layout', [['pages', 'Pages'], ['scroll', 'Scroll']]),
      group('Theme', 'theme', [['auto', 'Auto'], ['light', 'Light'], ['sepia', 'Sepia'], ['dark', 'Dark']]),
      group('Font', 'font', [['serif', 'Serif'], ['sans', 'Sans-serif']]),
      group('Line spacing', 'spacing', [[1.35, 'Compact'], [1.55, 'Normal'], [1.8, 'Airy']]),
      el('label', { class: 'r-choice r-justify' }, el('input', { type: 'checkbox', checked: s.justify, onchange: (e) => this.set('justify', e.target.checked) }), el('span', { text: 'Justify text' })));
  }

  set(name, value) {
    const anchor = this.currentBlock();
    this.settings[name] = value;
    store.set(SETTINGS_KEY, this.settings);
    this.applySettings();
    this.relayout(anchor);
  }

  applySettings() {
    const s = this.settings;
    const r = this.root;
    r.dataset.theme = s.theme === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : s.theme;
    r.dataset.layout = s.layout;
    r.dataset.font = s.font;
    r.style.setProperty('--r-size', `${(s.size / 100) * 1.12}rem`);
    r.style.setProperty('--r-spacing', s.spacing);
    r.classList.toggle('r-justified', !!s.justify);
  }

  /** @param book converted book; @param meta {title, author, key} */
  open(book, meta) {
    this.book = book;
    this.meta = meta;
    this.posKey = meta.key ? POS_PREFIX + meta.key : null;
    this.lengths = book.chapters.map((c) => c.blocks.reduce((a, b) => a + (b.runs ? b.runs.reduce((x, r) => x + (r.t?.length ?? 0), 0) : 1), 0) + c.title.length);
    this.total = this.lengths.reduce((a, b) => a + b, 0) || 1;
    this.titleEl.textContent = meta.title || book.meta.title || '';
    this.tocList.replaceChildren(...book.chapters.map((c, i) => el('li', { class: c.level === 2 ? 'sub' : '' },
      el('button', { type: 'button', onclick: () => { this.togglePanel(null); this.goto(i, 0); } }, c.title))));
    this.applySettings();
    this.root.hidden = false;
    document.body.classList.add('reading');
    if (history.state?.reader !== true) history.pushState({ reader: true }, '', '#read');
    const saved = this.posKey ? store.get(this.posKey, null) : null;
    const c = saved && saved.c < book.chapters.length ? saved.c : 0;
    this.renderChapter(c);
    requestAnimationFrame(() => {
      this.relayout(saved && saved.c === c ? saved.b : 0);
      this.viewport.focus({ preventScroll: true });
    });
  }

  requestClose() {
    if (history.state?.reader === true) history.back(); else this.close();
  }

  close() {
    this.savePosition();
    this.closePanels();
    this.root.hidden = true;
    document.body.classList.remove('reading');
    this.content.replaceChildren();
    this.book = null;
    document.getElementById('read')?.focus();
  }

  renderChapter(i) {
    const book = this.book;
    const ch = book.chapters[i];
    this.chapter = i;
    const lang = ch.lang || book.meta.lang || 'en';
    this.content.setAttribute('lang', lang);
    const nodes = [el(ch.level === 2 ? 'h2' : 'h1', { class: 'r-chapter-title', 'data-b': '0' }, ch.title)];
    ch.blocks.forEach((b, k) => {
      if (b.type === 'scene') nodes.push(el('p', { class: 'r-scene', role: 'separator', 'data-b': k + 1 }, '* * *'));
      else {
        const p = el('p', { 'data-b': k + 1 }, ...runsToNodes(b.runs, (n) => this.showNote(n)));
        if (b.lang && b.lang !== lang) p.setAttribute('lang', b.lang);
        nodes.push(p);
      }
    });
    if (ch.notes?.length) {
      nodes.push(el('section', { class: 'r-notes', 'aria-label': 'Notes' }, el('hr'),
        ...ch.notes.map((n) => el('p', { id: `r-note-${n.n}` }, el('span', { class: 'r-note-n' }, `${n.n}. `), ...runsToNodes(n.runs, () => {})))));
    }
    const last = i === book.chapters.length - 1;
    nodes.push(el('div', { class: 'r-end' }, last
      ? el('p', { class: 'r-the-end', text: '— Fin · Fi · The End —' })
      : el('button', { type: 'button', class: 'r-next-chapter', onclick: () => this.goto(i + 1, 0) }, `Next: ${book.chapters[i + 1].title} ›`)));
    this.content.replaceChildren(...nodes);
    this.tocList.querySelectorAll('button').forEach((b, k) => b.setAttribute('aria-current', k === i ? 'true' : 'false'));
  }

  goto(chapter, block = 0, { fromEnd = false } = {}) {
    if (!this.book || chapter < 0 || chapter >= this.book.chapters.length) return;
    if (chapter !== this.chapter) this.renderChapter(chapter);
    this.relayout(block, { fromEnd });
  }

  /** Lay the chapter out again (after resize/settings) and show `anchor`. */
  relayout(anchor = null, { fromEnd = false } = {}) {
    if (!this.book || this.root.hidden) return;
    const v = this.viewport;
    const c = this.content;
    const anchorBlock = anchor ?? this.currentBlock();
    if (this.settings.layout === 'pages') {
      const W = v.clientWidth, H = v.clientHeight;
      const pad = Math.max(16, Math.min(56, Math.round(W * 0.06)));
      const cols = W >= 1000 ? 2 : 1;
      const colW = (W - 2 * pad - (cols - 1) * 2 * pad) / cols;
      c.style.height = `${H}px`;
      c.style.columnWidth = `${colW}px`;
      c.style.columnGap = `${2 * pad}px`;
      c.style.padding = `0 ${pad}px`;
      this.step = W;
      // count pages from where the last element ends
      const lastEl = c.lastElementChild;
      const cRect = c.getBoundingClientRect();
      const end = lastEl ? lastEl.getBoundingClientRect().right - cRect.left : W;
      this.pages = Math.max(1, Math.ceil((end - 1) / W));
      const target = fromEnd ? this.pages - 1 : this.pageOf(anchorBlock);
      this.showPage(target);
    } else {
      c.style.height = c.style.columnWidth = c.style.columnGap = c.style.padding = '';
      const target = c.querySelector(`[data-b="${anchorBlock}"]`);
      if (fromEnd) v.scrollTop = v.scrollHeight;
      else if (target && anchorBlock > 0) v.scrollTop = target.offsetTop - c.offsetTop - 8;
      else v.scrollTop = 0;
    }
    this.updateProgress();
    this.savePosition();
  }

  pageOf(block) {
    const target = this.content.querySelector(`[data-b="${block}"]`);
    if (!target || block === 0) return 0;
    const x = target.getBoundingClientRect().left - this.content.getBoundingClientRect().left;
    return Math.min(this.pages - 1, Math.max(0, Math.floor((x + 2) / this.step)));
  }

  showPage(n) {
    this.page = Math.max(0, Math.min(this.pages - 1, n));
    this.viewport.scrollLeft = this.page * this.step;
    this.updateProgress();
  }

  next() {
    if (this.settings.layout === 'pages' && this.page < this.pages - 1) { this.showPage(this.page + 1); this.savePosition(); return; }
    if (this.settings.layout === 'scroll') {
      const v = this.viewport;
      if (v.scrollTop + v.clientHeight < v.scrollHeight - 4) { v.scrollBy({ top: v.clientHeight * 0.9, behavior: 'smooth' }); return; }
    }
    if (this.chapter < this.book.chapters.length - 1) this.goto(this.chapter + 1, 0);
  }

  prev() {
    if (this.settings.layout === 'pages' && this.page > 0) { this.showPage(this.page - 1); this.savePosition(); return; }
    if (this.settings.layout === 'scroll' && this.viewport.scrollTop > 4) { this.viewport.scrollBy({ top: -this.viewport.clientHeight * 0.9, behavior: 'smooth' }); return; }
    if (this.chapter > 0) this.goto(this.chapter - 1, 0, { fromEnd: true });
  }

  /** Index (data-b) of the first block visible on screen. */
  currentBlock() {
    if (!this.book) return 0;
    const blocks = this.content.querySelectorAll('[data-b]');
    const v = this.viewport.getBoundingClientRect();
    for (const b of blocks) {
      const r = b.getBoundingClientRect();
      if (this.settings.layout === 'pages' ? r.right > v.left + 2 && r.left < v.right : r.bottom > v.top + 2) return Number(b.dataset.b);
    }
    return 0;
  }

  updateProgress() {
    if (!this.book) return;
    const before = this.lengths.slice(0, this.chapter).reduce((a, b) => a + b, 0);
    let within;
    if (this.settings.layout === 'pages') within = this.pages > 1 ? this.page / (this.pages - 1) : 1;
    else {
      const v = this.viewport;
      const max = v.scrollHeight - v.clientHeight;
      within = max > 0 ? v.scrollTop / max : 1;
    }
    const pct = Math.round(((before + within * this.lengths[this.chapter]) / this.total) * 100);
    const n = this.book.chapters.length;
    const pageInfo = this.settings.layout === 'pages' ? ` · page ${this.page + 1}/${this.pages}` : '';
    this.progress.textContent = `Chapter ${this.chapter + 1}/${n}${pageInfo} · ${pct}%`;
    const atStart = this.chapter === 0 && (this.settings.layout === 'pages' ? this.page === 0 : this.viewport.scrollTop <= 4);
    const atEnd = this.chapter === n - 1 && (this.settings.layout === 'pages' ? this.page === this.pages - 1 : within >= 0.999);
    this.prevBtn.disabled = atStart;
    this.nextBtn.disabled = atEnd;
  }

  savePosition() {
    if (this.book && this.posKey) store.set(this.posKey, { c: this.chapter, b: this.currentBlock() });
  }

  showNote(n) {
    const note = this.book.chapters[this.chapter].notes?.find((x) => x.n === n);
    if (!note) return;
    this.notePanel.replaceChildren(
      el('div', { class: 'r-panel-head' }, el('strong', { text: `Note ${n}` }), el('button', { type: 'button', class: 'r-btn', 'aria-label': 'Close note', onclick: () => this.togglePanel(null) }, '✕')),
      el('p', {}, ...runsToNodes(note.runs, () => {})));
    this.togglePanel(this.notePanel);
  }

  togglePanel(panel) {
    for (const p of [this.drawer, this.settingsPanel, this.notePanel]) p.hidden = p !== panel || !p.hidden;
    if (panel && !panel.hidden) panel.querySelector('button, input')?.focus();
    else this.viewport.focus({ preventScroll: true });
  }

  closePanels() {
    const open = [this.drawer, this.settingsPanel, this.notePanel].some((p) => !p.hidden);
    if (open) this.togglePanel(null);
    return open;
  }

  onKey(e) {
    if (this.root.hidden || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Escape') { e.preventDefault(); if (!this.closePanels()) this.requestClose(); return; }
    if (e.target.closest?.('input, select, textarea')) return;
    const pages = this.settings.layout === 'pages';
    if (['ArrowRight', 'PageDown'].includes(e.key) || (pages && e.key === ' ' && !e.shiftKey)) { e.preventDefault(); this.next(); }
    else if (['ArrowLeft', 'PageUp'].includes(e.key) || (pages && e.key === ' ' && e.shiftKey)) { e.preventDefault(); this.prev(); }
  }
}

let instance = null;
export function openReader(book, meta) {
  instance ??= new Reader();
  instance.open(book, meta);
  return instance;
}
