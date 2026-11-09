// UI glue. All conversion code lives in src/core and runs locally.
import { convertToBook, sniffType } from '../core/convert.js';
import { buildEpub } from '../core/epub.js';
import { report } from '../core/report.js';
import { openReader, fileKey } from './reader.js';

const $ = (id) => document.getElementById(id);
const state = { bytes: null, name: '', book: null, busy: false, key: null };

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

async function convert(langOverride) {
  const type = sniffType(state.name, state.bytes);
  const opts = { lang: langOverride };
  if (type === 'pdf') {
    setStatus('Loading the PDF reader…');
    opts.pdfjs = await loadPdfjs();
    opts.onProgress = (done, total) => setStatus(`Reading page ${done} of ${total}…`);
  } else {
    setStatus('Converting…');
  }
  // let the status paint before heavy work
  await new Promise((r) => setTimeout(r, 0));
  return convertToBook(state.bytes, state.name, opts);
}

async function handleFile(file) {
  if (!file || state.busy) return;
  state.busy = true;
  showError('');
  $('result').hidden = true;
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
  const r = report(book);
  $('summary').textContent = `${r.chapters} chapter${r.chapters === 1 ? '' : 's'} · ${r.paragraphs.toLocaleString()} paragraphs · ${r.words.toLocaleString()} words${r.notes ? ` · ${r.notes} notes` : ''}`;
  const warnings = [...book.warnings];
  if (r.suspicious.length > Math.max(3, r.paragraphs * 0.02)) {
    warnings.push('Some paragraphs may be split or joined wrongly (the PDF layout is unusual). The Word file would convert better.');
  }
  renderWarnings(warnings);
  $('toc').replaceChildren(...book.chapters.map((c) => {
    const li = document.createElement('li');
    li.textContent = c.title;
    if (c.level === 2) li.className = 'sub';
    return li;
  }));
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
  const book = {
    ...state.book,
    meta: { ...state.book.meta, title: $('title').value.trim() || state.book.meta.title, author: $('author').value.trim(), lang: $('lang').value },
  };
  const confidential = confidentialLine();
  const cover = await makeCover(book.meta.title, book.meta.author, confidential);
  const bytes = buildEpub(book, { confidential, cover });
  return new File([bytes], fileName(), { type: 'application/epub+zip' });
}

async function download() {
  const file = await makeEpubFile();
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
  state.bytes = null; state.book = null;
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
  const book = { ...state.book, meta: { ...state.book.meta, lang: $('lang').value } };
  openReader(book, { title: $('title').value.trim() || book.meta.title, author: $('author').value.trim(), key: state.key });
});
$('download').addEventListener('click', () => withBusy($('download'), download));
$('share').addEventListener('click', () => withBusy($('share'), share));
$('again').addEventListener('click', reset);
$('lang').addEventListener('change', async () => {
  if (!state.bytes) return;
  const keep = { title: $('title').value, author: $('author').value };
  state.book = await convert($('lang').value);
  setStatus('');
  render();
  $('title').value = keep.title; $('author').value = keep.author;
});

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
