// pdf.js glue: PDF bytes -> positioned text items per page -> reflow.
// pdf.js is injected (browser: vendored module + worker; Node: same module).

import { reflow } from './reflow.js';

const SUBSET_RE = /^[A-Z]{6}\+/;

export function fontStyle(name = '') {
  const n = name.replace(SUBSET_RE, '');
  return {
    bold: /bold|black|heavy|semibold|demibold|demi\b|[-,_ ]bd\b|w[6-9]00/i.test(n),
    italic: /italic|oblique|[-,_ ]it\b|kursiv|slanted|-ital|[-,]i$/i.test(n),
  };
}

/**
 * @param {Uint8Array} bytes
 * @param {object} pdfjs  the pdf.js module (getDocument, Util)
 * @param {{onProgress?: (done:number, total:number) => void}} opts
 */
export async function readPdf(bytes, pdfjs, opts = {}) {
  let doc;
  let task;
  try {
    task = pdfjs.getDocument({
      data: bytes.slice(), // pdf.js may transfer (detach) the buffer
      isEvalSupported: false,
      fontExtraProperties: true,
      disableFontFace: true,
      useSystemFonts: false,
      disableAutoFetch: true,
      disableStream: true,
      verbosity: 0,
    });
    doc = await task.promise;
  } catch (e) {
    if (e && e.name === 'PasswordException') throw new Error('This PDF is password-protected. Ask for an unprotected copy or the Word file.');
    throw new Error(`This PDF could not be read. It may be damaged. (${e?.message ?? e})`);
  }
  const meta = {};
  try {
    const { info } = await doc.getMetadata();
    if (info?.Title && !/^(untitled|microsoft word|document)/i.test(info.Title) && !/\.(docx?|pdf|odt|pages)$/i.test(info.Title)) meta.title = info.Title.trim();
    if (info?.Author && !/^(user|usuario|admin|author)$/i.test(info.Author.trim())) meta.author = info.Author.trim();
    if (info?.Language) meta.langHint = String(info.Language).slice(0, 2).toLowerCase();
  } catch { /* metadata is optional */ }

  const fonts = new Map(); // loadedName -> {bold, italic, name}
  // Bookmarks (outline): the real chapter titles of typeset books.
  const outline = [];
  try {
    const walk = async (items, level) => {
      for (const it of items || []) {
        let page = null;
        try {
          let dest = it.dest;
          if (typeof dest === 'string') dest = await doc.getDestination(dest);
          if (Array.isArray(dest) && dest[0] != null) page = (typeof dest[0] === 'object' ? await doc.getPageIndex(dest[0]) : dest[0]) + 1;
        } catch { /* unresolvable destination */ }
        outline.push({ title: (it.title || '').replace(/\s+/g, ' ').trim(), page, level });
        if (level < 3) await walk(it.items, level + 1);
      }
    };
    await walk(await doc.getOutline(), 1);
  } catch { /* no outline */ }
  const pages = [];
  let chars = 0;
  let rotated = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const raw = tc.items.filter((it) => typeof it.str === 'string' && it.str.length);
    // Resolve real font names (for bold/italic) only when a new font appears.
    if (raw.some((it) => !fonts.has(it.fontName))) {
      try { await page.getOperatorList(); } catch { /* ignore */ }
      for (const it of raw) {
        if (fonts.has(it.fontName)) continue;
        let name = '';
        try { name = page.commonObjs.get(it.fontName)?.name ?? ''; } catch { /* unresolved */ }
        fonts.set(it.fontName, { name, ...fontStyle(name || tc.styles[it.fontName]?.fontFamily) });
      }
    }
    const items = [];
    for (const it of raw) {
      const m = pdfjs.Util.transform(vp.transform, it.transform);
      // m = [a, b, c, d, e, f] in viewport space (y grows downwards)
      if (Math.abs(m[1]) > 0.01 || Math.abs(m[2]) > 0.01) { rotated++; continue; }
      const fs = Math.abs(m[3]) || Math.hypot(m[2], m[3]);
      if (!fs) continue;
      const f = fonts.get(it.fontName) ?? {};
      items.push({ str: it.str, x: m[4], y: m[5], w: it.width * vp.scale, fs, bold: !!f.bold, italic: !!f.italic });
      chars += it.str.replace(/\s/g, '').length;
    }
    pages.push({ n: p, width: vp.width, height: vp.height, items });
    page.cleanup();
    opts.onProgress?.(p, doc.numPages);
  }
  await task.destroy();

  const warnings = [];
  const textPages = pages.filter((pg) => pg.items.reduce((a, it) => a + it.str.trim().length, 0) > 40).length;
  if (chars / Math.max(1, pages.length) < 25 || textPages < pages.length * 0.25) {
    return {
      scanned: true,
      meta,
      warnings: ['This PDF is a scan: its pages are images with no text layer, so it cannot be converted. Ask the author or agent for the Word file (or a PDF exported directly from Word).'],
    };
  }
  if (textPages < pages.length * 0.8) {
    warnings.push(`Some pages (${pages.length - textPages} of ${pages.length}) have no text layer and were skipped (they may be scanned images).`);
  }
  if (rotated > chars * 0.05) warnings.push('Some rotated text was ignored.');
  const res = reflow(pages, { ...opts, known: [meta.title, meta.author] });
  // raw pages are kept so the book can be rebuilt with other options, and
  // for the anonymised problem report
  return { ...res, pages, outline, meta, warnings: [...warnings, ...res.warnings], source: 'pdf' };
}
