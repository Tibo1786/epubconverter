// UI glue. All conversion code lives in src/core and runs locally.
import { readManuscript, buildFromRaw, sniffType, APP_VERSION } from '../core/convert.js';
import { headingOptions } from '../core/headings.js';
import { STANDALONE_RE } from '../core/patterns.js';
import { buildDiagnosticReport } from '../core/diagnostic.js';
import { buildEpub } from '../core/epub.js';
import { report } from '../core/report.js';
import { openReader, fileKey } from './reader.js';

const $ = (id) => document.getElementById(id);
const state = { bytes: null, name: '', raw: null, book: null, busy: false, key: null, rules: new Map(), titles: new Map(), editing: false };

const prefs = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

let pdfjsPromise = null;
function loadPdfjs() {
  // Loaded only when a PDF is opened. Same origin, allowed by the CSP.
  pdfjsPromise ??= import('../../vendor/pdfjs/pdf.min.mjs').then((mod) => {
    mod.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
    return mod;
  });
  return pdfjsPromise;
}

function setStatus(msg) { $('status').textContent = msg; }

function showError(msg) {
  const e = $('error');
  e.textContent = msg;
  e.hidden = !msg;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function confidentialLine() {
  if (!$('confidential').checked) return '';
  const v = $('received').value;
  const d = v ? new Date(`${v}T12:00:00`) : new Date();
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return `Confidential submission, received ${date}`;
}

/** Current conversion options from the form. */
function options(lang) {
  const id = $('headings').value;
  return { lang, faithful: $('faithful').checked, headingRule: id === 'auto' ? null : state.rules.get(id) ?? null };
}

/** Read the file (slow part); the book itself is rebuilt by rebuild(). */
async function convert() {
  const type = sniffType(state.name, state.bytes);
  const opts = { faithful: $('faithful').checked };
  if (type === 'pdf') {
    setStatus('Loading the PDF reader…');
    opts.pdfjs = await loadPdfjs();
    opts.onProgress = (done, total) => setStatus(`Reading page ${done} of ${total}…`);
  } else {
    setStatus('Converting…');
  }
  // let the status paint before heavy work
  await new Promise((r) => setTimeout(r, 0));
  state.raw = await readManuscript(state.bytes, state.name, opts);
  $('headings').value = 'auto';
  return buildFromRaw(state.raw, options());
}

/** Rebuild the book with the current options (fast: no re-reading). */
function rebuild() {
  if (!state.raw || state.raw.scanned) return;
  const keep = { title: $('title').value, author: $('author').value };
  const before = state.book?.chapters.length;
  state.book = buildFromRaw(state.raw, options($('lang').value));
  if (state.book.chapters.length !== before) state.titles.clear();
  render();
  $('title').value = keep.title; $('author').value = keep.author;
}

function fillHeadingChoices() {
  const sel = $('headings');
  const opts = state.raw && !state.raw.scanned ? headingOptions(state.raw.blocks) : [];
  state.rules = new Map(opts.map((o) => [o.id, { kind: o.kind, value: o.value }]));
  const current = sel.value;
  const auto = state.book?.headingRule?.automatic ? `Automatic (found: ${state.book.headingRule.label.toLowerCase()})` : 'Automatic';
  sel.replaceChildren(
    Object.assign(document.createElement('option'), { value: 'auto', textContent: auto }),
    ...opts.map((o) => Object.assign(document.createElement('option'), {
      value: o.id,
      textContent: `${o.label} · ${o.count} chapters, e.g. “${o.example}”`,
    })));
  sel.value = state.rules.has(current) ? current : 'auto';
}

async function handleFile(file) {
  if (!file || state.busy) return;
  state.busy = true;
  showError('');
  $('result').hidden = true;
  $('report-box').hidden = true;
  $('report-done').hidden = true;
  state.raw = null; state.book = null; state.titles.clear(); state.editing = false;
  state.name = file.name;
  try {
    state.bytes = new Uint8Array(await file.arrayBuffer());
    state.key = await fileKey(state.bytes);
    const book = await convert();
    if (book.scanned) {
      showOnlyMessage(book.warnings[0]);
      return;
    }
    state.book = book;
    fillHeadingChoices();
    $('title').value = book.meta.title || '';
    $('author').value = book.meta.author || '';
    $('lang').value = book.meta.lang || 'en';
    if (!$('received').value) $('received').value = today();
    render();
    setStatus('');
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    console.error(e);
    showOnlyMessage(e.message || String(e));
  } finally {
    state.busy = false;
  }
}

/** Scanned PDF or unreadable file: show the explanation and a way back. */
function showOnlyMessage(msg) {
  setStatus('');
  $('result').hidden = false;
  for (const el of [$('meta'), $('toc-box'), document.querySelector('.preview'), $('read'), $('download'), $('share')]) el.hidden = true;
  $('report-open').hidden = !state.raw;
  $('summary').textContent = '';
  $('warnings').replaceChildren();
  document.querySelector('.actions').hidden = false;
  showError(msg);
}

function renderWarnings(list) {
  $('warnings').replaceChildren(...list.map((w) => Object.assign(document.createElement('li'), { textContent: w })));
}

function render() {
  const book = state.book;
  $('result').hidden = false;
  $('meta').hidden = false;
  $('toc-box').hidden = false;
  document.querySelector('.preview').hidden = false;
  document.querySelector('.actions').hidden = false;
  $('download').hidden = false;
  $('read').hidden = false;
  $('report-open').hidden = false;
  const r = report(book);
  $('summary').textContent = `${r.chapters} chapter${r.chapters === 1 ? '' : 's'} · ${r.paragraphs.toLocaleString()} paragraphs · ${r.words.toLocaleString()} words${r.notes ? ` · ${r.notes} notes` : ''}`;
  const warnings = [...book.warnings];
  if (r.suspicious.length > Math.max(3, r.paragraphs * 0.02)) {
    warnings.push('Some paragraphs may be split or joined wrongly (the PDF layout is unusual). The Word file would convert better.');
  }
  renderWarnings(warnings);
  renderToc();
  // preview: first ~12 blocks
  const out = [];
  let count = 0;
  for (const c of book.chapters) {
    if (count > 12) break;
    out.push(Object.assign(document.createElement('h3'), { textContent: c.title }));
    for (const b of c.blocks) {
      if (++count > 12) break;
      if (b.type === 'scene') { out.push(Object.assign(document.createElement('p'), { className: 'scene', textContent: '* * *' })); continue; }
      const p = document.createElement('p');
      for (const run of b.runs) {
        if (run.t === undefined) continue;
        let node = document.createTextNode(run.t);
        if (run.b) { const el = document.createElement('b'); el.append(node); node = el; }
        if (run.i) { const el = document.createElement('i'); el.append(node); node = el; }
        p.append(node);
      }
      out.push(p);
    }
  }
  $('preview').replaceChildren(...out);
  $('share').hidden = !canShareFiles();
}

/** Chapter titles with the user's edits applied. */
function chapterTitle(c, i) { return state.titles.get(i) ?? c.title; }

function bookForOutput() {
  return {
    ...state.book,
    chapters: state.book.chapters.map((c, i) => ({ ...c, title: chapterTitle(c, i) })),
    meta: { ...state.book.meta, title: $('title').value.trim() || state.book.meta.title, author: $('author').value.trim(), lang: $('lang').value },
  };
}

function renderToc() {
  const book = state.book;
  $('toc').replaceChildren(...book.chapters.map((c, i) => {
    const li = document.createElement('li');
    if (c.level === 2) li.className = 'sub';
    if (state.editing) {
      const input = Object.assign(document.createElement('input'), { type: 'text', value: chapterTitle(c, i), className: 'toc-input' });
      input.setAttribute('aria-label', `Title of chapter ${i + 1}`);
      input.addEventListener('input', () => {
        if (input.value.trim() && input.value !== c.title) state.titles.set(i, input.value.trim()); else state.titles.delete(i);
      });
      li.append(input);
    } else {
      li.textContent = chapterTitle(c, i);
    }
    return li;
  }));
  $('edit-titles').textContent = state.editing ? 'Done' : 'Edit titles';
}

/** "Chapter 1, 2, 3…" for chapters that share the usual title look. */
function numberChapters() {
  const word = { es: 'Capítulo', ca: 'Capítol', en: 'Chapter', fr: 'Chapitre' }[$('lang').value] || 'Chapter';
  const chs = state.book.chapters;
  const sizes = new Map();
  for (const c of chs) if (c.size && !c.untitled) sizes.set(c.size, (sizes.get(c.size) ?? 0) + 1);
  const main = [...sizes].sort((a, b) => b[1] - a[1])[0]?.[0];
  // Front matter (title page, copyright) comes before the first chapter with
  // the usual title look; prologues, epilogues and notes keep their names.
  const firstMain = main ? chs.findIndex((c) => !c.untitled && c.size && Math.abs(c.size - main) <= 0.6 && !STANDALONE_RE.test(c.title)) : 0;
  let n = 0;
  chs.forEach((c, i) => {
    if (i < firstMain || c.untitled || STANDALONE_RE.test(c.title)) return;
    state.titles.set(i, `${word} ${++n}`);
  });
  renderToc();
}

function canShareFiles() {
  try {
    const f = new File([new Uint8Array(1)], 'x.epub', { type: 'application/epub+zip' });
    return !!(navigator.canShare && navigator.canShare({ files: [f] }));
  } catch { return false; }
}

/** A plain typographic cover so books are easy to tell apart in a library. */
async function makeCover(title, author, confidential) {
  try {
    const W = 1000, H = 1500;
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
    const g = canvas.getContext('2d');
    g.fillStyle = '#f4ece1'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#7a2e1f'; g.fillRect(0, 0, W, 36); g.fillRect(0, H - 36, W, 36);
    g.fillStyle = '#2b2522';
    g.textAlign = 'center';
    const wrap = (text, font, maxW) => {
      g.font = font;
      const words = text.split(/\s+/); const lines = []; let line = '';
      for (const w of words) {
        const t = line ? `${line} ${w}` : w;
        if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
      }
      if (line) lines.push(line);
      return lines;
    };
    const tl = wrap(title, '84px Georgia, "Times New Roman", serif', W - 160).slice(0, 6);
    let y = 520 - (tl.length - 1) * 50;
    for (const l of tl) { g.fillText(l, W / 2, y); y += 100; }
    if (author) {
      g.font = '52px Georgia, "Times New Roman", serif'; g.fillStyle = '#6d6460';
      g.fillText(author, W / 2, y + 80);
    }
    if (confidential) {
      g.font = 'italic 34px Georgia, "Times New Roman", serif'; g.fillStyle = '#7a2e1f';
      for (const [i, l] of wrap(confidential, 'italic 34px Georgia, serif', W - 200).entries()) g.fillText(l, W / 2, H - 180 + i * 46);
    }
    const blob = canvas.convertToBlob ? await canvas.convertToBlob({ type: 'image/png' }) : await new Promise((r) => canvas.toBlob(r, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null; // a cover is a nicety, never a reason to fail
  }
}

function fileName() {
  const t = $('title').value.trim() || 'Manuscript';
  const a = $('author').value.trim();
  // ASCII file name: some browsers refuse accented names for downloads
  // (the real title, with accents, is inside the EPUB).
  const base = `${a ? `${a} - ` : ''}${t}`.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/·/g, '')
    .replace(/[^\x20-\x7e]+/g, '').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();
  return `${base.slice(0, 120) || 'manuscript'}.epub`;
}

async function makeEpubFile() {
  const book = bookForOutput();
  const confidential = confidentialLine();
  const cover = await makeCover(book.meta.title, book.meta.author, confidential);
  const bytes = buildEpub(book, { confidential, cover });
  return new File([bytes], fileName(), { type: 'application/epub+zip' });
}

async function download() {
  saveFile(await makeEpubFile());
}

function saveFile(file) {
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function share() {
  const file = await makeEpubFile();
  try {
    await navigator.share({ files: [file], title: file.name });
  } catch (e) {
    if (e?.name !== 'AbortError') showError(`Sharing failed (${e.message}). Use Download instead.`);
  }
}

function reset() {
  state.bytes = null; state.book = null; state.raw = null;
  $('report-box').hidden = true;
  $('file').value = '';
  $('result').hidden = true;
  showError('');
  setStatus('');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// --- wiring
$('file').addEventListener('change', (e) => handleFile(e.target.files[0]));
const drop = $('drop');
for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); });
$('read').addEventListener('click', () => {
  const book = bookForOutput();
  openReader(book, { title: book.meta.title, author: book.meta.author, key: state.key });
});
$('download').addEventListener('click', () => withBusy($('download'), download));
$('share').addEventListener('click', () => withBusy($('share'), share));
$('again').addEventListener('click', reset);
$('lang').addEventListener('change', rebuild);
$('edit-titles').addEventListener('click', () => { state.editing = !state.editing; renderToc(); if (state.editing) $('toc').querySelector('input')?.focus(); });
$('number-titles').addEventListener('click', () => { $('toc-box').open = true; numberChapters(); });
$('headings').addEventListener('change', rebuild);
$('faithful').checked = prefs.get('mr-faithful', false);
$('faithful').addEventListener('change', () => { prefs.set('mr-faithful', $('faithful').checked); rebuild(); });
$('report-open').addEventListener('click', () => {
  $('report-box').hidden = !$('report-box').hidden;
  if (!$('report-box').hidden) $('report-note').focus();
});
$('report-create').addEventListener('click', () => withBusy($('report-create'), async () => {
  const zip = buildDiagnosticReport(state.raw, state.book ?? { scanned: !!state.raw?.scanned, chapters: [], warnings: [] }, {
    bytes: state.bytes,
    note: $('report-note').value.trim(),
    version: APP_VERSION,
    settings: { lang: $('lang').value, faithful: $('faithful').checked, headings: $('headings').value },
  });
  saveFile(new File([zip], `manuscript-problem-report-${today()}.zip`, { type: 'application/zip' }));
  $('report-done').hidden = false;
}));

async function withBusy(btn, fn) {
  btn.disabled = true;
  try { await fn(); } catch (e) { showError(e.message || String(e)); } finally { btn.disabled = false; }
}

// A #read left in the address bar (reload while reading) has no book behind it.
if (location.hash === '#read') history.replaceState(null, '', location.pathname);

const secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
if ('serviceWorker' in navigator && secure) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
}
