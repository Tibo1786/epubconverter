// PDF reflow: positioned text items -> paragraphs, headings, scene breaks.
//
// Pipeline (each step is exported for unit tests):
//   buildLines       items -> lines (baseline clustering, space inference,
//                    superscripts)
//   docStats         body font size, line pitch, margins per page, indent
//   stripFurniture   running headers/footers, page numbers, footnotes
//   classify         heading / scene / body lines
//   assemble         lines -> paragraphs (indent, gaps, short lines,
//                    page breaks), dehyphenation
//
// Ideas borrowed from Calibre's PDF input (line-length statistics, the
// "unwrap" decision) and pdftotext (baseline grouping, header detection).

import { joinHyphenated, endsWithHyphenation, WordStats } from '../dehyphen.js';
import { detectLanguage } from '../lang.js';
import { headingKind, isSceneBreak, PAGE_NUMBER_RE, SENTENCE_END_RE } from '../patterns.js';

const round = (v, q = 0.5) => Math.round(v / q) * q;

function mode(values, q = 0.5, weights) {
  const h = new Map();
  values.forEach((v, i) => {
    const k = round(v, q);
    h.set(k, (h.get(k) ?? 0) + (weights ? weights[i] : 1));
  });
  let best = null, bestN = -1;
  for (const [k, n] of h) if (n > bestN || (n === bestN && k < best)) { best = k; bestN = n; }
  return best;
}

function percentile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

// ------------------------------------------------------------- 1. lines ----

/**
 * Text drawn on top of the same text is a copy: transparency flattening
 * (e.g. under a diagonal watermark), shadows and "fake bold" all redraw
 * pieces of a line at the exact same place. Keep the widest item and drop
 * any item mostly covered by already kept items on the same baseline.
 */
export function dropOverlaps(items) {
  const byWidth = [...items].sort((a, b) => b.w - a.w);
  const kept = [];
  const rows = new Map();
  for (const it of byWidth) {
    if (it.w > 0 && it.str.trim()) {
      const key = Math.round(it.y);
      let covered = 0;
      for (const k of [key - 1, key, key + 1]) {
        for (const o of rows.get(k) ?? []) {
          if (Math.abs(o.fs - it.fs) > 0.5 || Math.abs(o.y - it.y) > 0.2 * it.fs) continue;
          const overlap = Math.min(o.x + o.w, it.x + it.w) - Math.max(o.x, it.x);
          if (overlap > 0) covered += overlap;
        }
      }
      if (covered >= 0.6 * it.w) continue;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(it);
    }
    kept.push(it);
  }
  return kept;
}

/**
 * A drop cap: one or two big letters whose height spans two or more body
 * lines to their right. Returned separately so they can be glued to the
 * first of those lines instead of disturbing line grouping.
 */
function splitDropCaps(items) {
  const chars = new Map();
  for (const it of items) chars.set(round(it.fs), (chars.get(round(it.fs)) ?? 0) + it.str.trim().length);
  let body = null, best = -1;
  for (const [k, n] of chars) if (n > best) { body = k; best = n; }
  if (!body) return { items, caps: [] };
  const caps = [];
  const rest = [];
  for (const it of items) {
    const t = it.str.trim();
    if (t.length >= 1 && t.length <= 2 && /^\p{L}+$/u.test(t) && it.fs >= 2.2 * body) {
      // body lines to the right, within the cap's height
      const beside = new Set(items.filter((o) => o !== it && Math.abs(o.fs - body) < 0.6 && o.x >= it.x + it.w * 0.6 - 2 &&
        o.y <= it.y + 0.3 * body && o.y >= it.y - it.fs * 0.85).map((o) => Math.round(o.y)));
      if (beside.size >= 2) { caps.push(it); continue; }
    }
    rest.push(it);
  }
  return { items: rest, caps };
}

/** Group the items of one page into lines. */
export function buildLines(page) {
  const { items: plain, caps } = splitDropCaps(dropOverlaps(page.items.filter((it) => it.str.length)));
  const items = plain
    .map((it) => ({ ...it }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const it of items) {
    let target = null;
    let best = Infinity;
    for (let k = lines.length - 1; k >= Math.max(0, lines.length - 4); k--) {
      const l = lines[k];
      const tol = 0.45 * Math.max(l.fs, it.fs);
      const dy = Math.abs(l.y - it.y);
      // Raised small text (superscript) belongs to the line below it.
      const sup = it.fs < 0.85 * l.fs && it.y < l.y && l.y - it.y < 0.7 * l.fs;
      if ((dy <= tol || sup) && dy < best) { best = dy; target = l; }
    }
    if (!target) {
      target = { y: it.y, fs: it.fs, items: [] };
      lines.push(target);
    }
    target.items.push(it);
    if (it.fs > target.fs && it.str.trim()) { target.fs = it.fs; target.y = it.y; }
  }
  const out = lines.map((l) => finishLine(l, page)).filter((l) => l.text.length);
  // glue each drop cap to the top line beside it ("M" + "argot")
  for (const cap of caps) {
    const beside = out.filter((l) => l.x0 >= cap.x + cap.w * 0.6 - 2 && l.y <= cap.y + 0.3 * l.fs && l.y >= cap.y - cap.fs * 0.85)
      .sort((a, b) => a.y - b.y);
    const line = beside[0];
    if (!line) continue;
    for (const l of beside) l.besideCap = true; // pushed right by the cap, not indented
    const first = line.runs[0];
    line.runs.unshift({ t: cap.str.trim(), ...(first?.i ? { i: true } : {}), ...(first?.b ? { b: true } : {}) });
    line.text = cap.str.trim() + line.text;
    line.x0 = Math.min(line.x0, cap.x);
    line.dropCap = cap.str.trim();
  }
  return out;
}

function finishLine(l, page) {
  const items = l.items.sort((a, b) => a.x - b.x);
  // body size of the line = size with most characters
  const sizeChars = new Map();
  for (const it of items) {
    const k = round(it.fs);
    sizeChars.set(k, (sizeChars.get(k) ?? 0) + it.str.trim().length);
  }
  let fs = l.fs, bestN = -1;
  for (const [k, n] of sizeChars) if (n > bestN) { fs = k; bestN = n; }
  const baseItems = items.filter((it) => Math.abs(round(it.fs) - fs) < 0.6 && it.str.trim());
  const y = baseItems.length ? mode(baseItems.map((it) => it.y), 0.5) : l.y;

  const runs = [];
  let prevEnd = null;
  let pendingSpace = false;
  let lastStr = null, lastX = null;
  const push = (t, it, sup) => {
    const r = { t };
    if (it.italic) r.i = true;
    if (it.bold) r.b = true;
    if (sup) r.sup = true;
    const last = runs[runs.length - 1];
    if (last && !!last.i === !!r.i && !!last.b === !!r.b && !!last.sup === !!r.sup) last.t += t;
    else runs.push(r);
  };
  let x0 = null, x1 = null;
  for (const it of items) {
    if (!it.str.trim()) {
      // a standalone space item: a real word space only if it is wide enough
      if (it.w >= 0.18 * it.fs) pendingSpace = true;
      continue;
    }
    // fake bold: the same string drawn twice at (almost) the same place
    if (lastStr === it.str && Math.abs(lastX - it.x) < 0.3 * it.fs) continue;
    const sup = it.fs < 0.85 * fs && y - it.y > 0.15 * fs;
    const prevText = runs.length ? runs[runs.length - 1].t : '';
    if (prevEnd !== null) {
      const gap = it.x - prevEnd;
      const needSpace = !/\s$/.test(prevText) && !/^\s/.test(it.str) &&
        (pendingSpace || gap > 0.17 * Math.min(it.fs, fs));
      if (needSpace) push(' ', it, false);
    }
    push(it.str, it, sup);
    pendingSpace = false;
    prevEnd = it.x + it.w;
    if (x0 === null) x0 = it.x + (it.str.length - it.str.trimStart().length) * it.fs * 0.25;
    x1 = Math.max(x1 ?? 0, it.x + it.w);
    lastStr = it.str;
    lastX = it.x;
  }
  // trim
  while (runs.length && !runs[0].t.trim()) runs.shift();
  if (runs.length) runs[0].t = runs[0].t.replace(/^\s+/, '');
  while (runs.length && !runs[runs.length - 1].t.trim()) runs.pop();
  if (runs.length) runs[runs.length - 1].t = runs[runs.length - 1].t.replace(/\s+$/, '');
  for (const r of runs) r.t = r.t.replace(/\s{2,}/g, ' ');
  const text = runs.map((r) => r.t).join('');
  const letters = runs.filter((r) => r.t.trim() && !r.sup);
  return {
    page: page.n, pageW: page.width, pageH: page.height,
    y, fs, x0: x0 ?? 0, x1: x1 ?? 0, runs, text,
    bold: letters.length > 0 && letters.every((r) => r.b),
    italic: letters.length > 0 && letters.every((r) => r.i),
  };
}

// ------------------------------------------------------------- 2. stats ----

export function docStats(lines) {
  const sizes = lines.map((l) => l.fs);
  const weights = lines.map((l) => l.text.length);
  const bodyFs = mode(sizes, 0.5, weights) ?? 12;
  const isBody = (l) => Math.abs(l.fs - bodyFs) <= 0.6;
  const body = lines.filter(isBody);

  // line pitch: distance between consecutive body lines on a page
  const gaps = [];
  for (let k = 1; k < body.length; k++) {
    const a = body[k - 1], b = body[k];
    if (a.page !== b.page) continue;
    const d = b.y - a.y;
    if (d > 0.8 * bodyFs && d < 4 * bodyFs) gaps.push(d);
  }
  const pitch = mode(gaps, 0.5) ?? bodyFs * 1.2;
  // paragraph spacing (block paragraphs): a second common gap, clearly larger
  const bigGaps = gaps.filter((d) => d > pitch * 1.25 && d < pitch * 2.6);
  const paraGap = bigGaps.length >= Math.max(3, gaps.length * 0.08) ? mode(bigGaps, 0.5) : null;

  // margins per page (mirrored margins are common), with a global fallback.
  // The left margin is the leftmost COMMON line start: on a short page,
  // indented starts (paragraphs, list items) can outnumber margin starts.
  const leftEdge = (xs) => {
    const h = new Map();
    for (const x of xs) h.set(Math.round(x), (h.get(Math.round(x)) ?? 0) + 1);
    const need = Math.max(2, Math.ceil(xs.length * 0.15));
    const common = [...h].filter(([, n]) => n >= need).map(([k]) => k);
    return common.length ? Math.min(...common) : mode(xs, 1);
  };
  const leftAll = leftEdge(body.map((l) => l.x0));
  const rightAll = percentile(body.map((l) => l.x1), 0.9);
  const perPage = new Map();
  const byPage = new Map();
  for (const l of body) {
    if (!byPage.has(l.page)) byPage.set(l.page, []);
    byPage.get(l.page).push(l);
  }
  const parity = { 0: { l: [], r: [] }, 1: { l: [], r: [] } };
  for (const [p, ls] of byPage) {
    if (ls.length >= 6) {
      const left = leftEdge(ls.map((l) => l.x0));
      const right = percentile(ls.map((l) => l.x1), 0.85);
      perPage.set(p, { left, right });
      parity[p % 2].l.push(left);
      parity[p % 2].r.push(right);
    }
  }
  const parityMargins = [0, 1].map((k) => ({
    left: parity[k].l.length ? mode(parity[k].l, 1) : leftAll,
    right: parity[k].r.length ? mode(parity[k].r, 1) : rightAll,
  }));
  const margins = (page) => perPage.get(page) ?? parityMargins[page % 2];

  // first-line indent
  const offs = [];
  for (const l of body) {
    const { left } = margins(l.page);
    const d = l.x0 - left;
    if (d > 0.6 * bodyFs && d < 6 * bodyFs) offs.push(d);
  }
  const indent = offs.length >= Math.max(3, body.length * 0.03) ? mode(offs, 1) : null;
  return { bodyFs, pitch, paraGap, indent, margins, isBody, bodyCount: body.length };
}

// ------------------------------------------- 3. headers, footers, notes ----

const normKey = (t) => t.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
const keyOf = (t) => t.toLowerCase().replace(/\d+/g, '#').replace(/[ivxlcdm]+\b/g, (m) => (m.length <= 6 ? '#' : m)).replace(/\s+/g, '');

/**
 * Remove running headers/footers and page numbers; extract footnotes.
 * Returns {lines, notes: Map<string, runs>, removed: string[]}
 */
export function stripFurniture(pagesLines, stats, known = []) {
  const nPages = pagesLines.length;
  const candidates = [];
  for (const pl of pagesLines) {
    if (!pl.length) continue;
    const H = pl[0].pageH;
    const sorted = [...pl].sort((a, b) => a.y - b.y);
    const top = sorted.slice(0, 2).filter((l) => l.y < H * 0.13);
    const bottom = sorted.slice(-2).filter((l) => l.y > H * 0.86);
    for (const l of [...top, ...bottom]) candidates.push(l);
  }
  const counts = new Map();
  for (const l of candidates) {
    const k = keyOf(l.text);
    if (!counts.has(k)) counts.set(k, new Set());
    counts.get(k).add(l.page);
  }
  // Odd/even headers alternate, so a short document may show each only twice.
  const minRepeat = nPages < 12 ? 2 : 3;
  const furniture = new Set();
  const removed = [];
  for (const l of candidates) {
    if (isSceneBreak(l.text)) continue;
    // Running headers do not end like sentences; this protects body lines
    // that happen to repeat at the top of pages (e.g. a dialogue line "—No.").
    const { left, right } = stats.margins(l.page);
    // ...and are short: a line spanning most of the text width is body text
    // that happens to repeat (common phrases at the top of a page).
    const wide = right > left && l.x1 - l.x0 > 0.7 * (right - left);
    const repeated = counts.get(keyOf(l.text)).size >= minRepeat && !/[.!?…]["”»’)]?$/.test(l.text) && !wide;
    // "Title — Author    Página 3 de 120": a header that carries "page N of M"
    // is furniture even when it appears only once (short documents).
    const pageOfN = /\b(?:p[aá]g(?:ina)?|p[àa]gina|page|seite)\.?\s*\d{1,4}\s*(?:\/|de|of|sur|von)\s*\d{1,4}\b/i.test(l.text);
    // the book's own title or author as a running head (short documents)
    const isKnown = known.some((k) => k && normKey(k) === normKey(l.text));
    if (repeated || pageOfN || isKnown || PAGE_NUMBER_RE.test(l.text)) {
      furniture.add(l);
      removed.push(l.text);
    }
  }

  // Footnotes: small text at the bottom of the page, below the body.
  const notes = new Map();
  const out = [];
  for (const pl of pagesLines) {
    const lines = pl.filter((l) => !furniture.has(l)).sort((a, b) => a.y - b.y);
    let k = lines.length;
    const small = (l) => l.fs < stats.bodyFs * 0.95 && l.fs <= stats.bodyFs - 0.5;
    while (k > 0 && small(lines[k - 1]) && lines[k - 1].y > lines[0].pageH * 0.5) k--;
    const area = lines.slice(k);
    const startsNote = (l) => /^\d{1,3}\b/.test(l.text) || (l.runs[0]?.sup && /^\d{1,3}$/.test(l.runs[0].t.trim()));
    if (area.length && startsNote(area[0]) && k > 0) {
      let cur = null;
      for (const l of area) {
        const m = l.text.match(/^(\d{1,3})\s*(.*)$/);
        if (m && (l.runs[0]?.sup || /^\d{1,3}\s/.test(l.text) || startsNote(l))) {
          cur = { num: m[1], runs: [] };
          notes.set(`p${l.page}-${m[1]}`, cur.runs);
          const rest = l.runs.map((r) => ({ ...r }));
          // drop the number from the first run(s)
          let drop = m[1].length;
          while (drop > 0 && rest.length) {
            const r = rest[0];
            const t = r.t.replace(/^\s+/, '');
            if (t.length <= drop) { drop -= t.length; rest.shift(); } else { r.t = t.slice(drop); drop = 0; }
          }
          if (rest[0]) rest[0].t = rest[0].t.replace(/^\s+/, '');
          cur.runs.push(...rest.map(({ sup, ...r }) => r));
        } else if (cur) {
          joinRunsInto(cur.runs, l.runs.map(({ sup, ...r }) => r), l.text);
        }
      }
      out.push(lines.slice(0, k));
    } else {
      out.push(lines);
    }
  }
  return { lines: out, notes, removed };
}

function joinRunsInto(target, runs, nextText, ctx = {}) {
  const last = target[target.length - 1];
  const prevText = target.map((r) => r.t ?? '').join('');
  if (last && last.t !== undefined && endsWithHyphenation(prevText) && /^\p{Ll}/u.test(nextText)) {
    const j = joinHyphenated(prevText.slice(-40), nextText, ctx);
    if (j.join) {
      const hyIdx = last.t.length - 1;
      const restore = j.text.slice(prevText.slice(-40).length - 1, prevText.slice(-40).length) === '·' ? '·' : '';
      last.t = last.t.slice(0, hyIdx) + restore;
    }
  } else if (last && last.t !== undefined && /\p{L}—$/u.test(last.t) && /^\p{L}/u.test(nextText)) {
    // closed em dash at line end: no space
  } else if (target.length) {
    // the joining space keeps the formatting when both sides share it
    const first = runs[0] ?? {};
    const sp = { t: ' ' };
    if (last?.i && first.i) sp.i = true;
    if (last?.b && first.b) sp.b = true;
    target.push(sp);
  }
  target.push(...runs.map((r) => ({ ...r })));
}

// ---------------------------------------------------------- 4. classify ----

function isCentered(l, stats) {
  const { left, right } = stats.margins(l.page);
  if (left == null || right == null) return false;
  const leftGap = l.x0 - left;
  const rightGap = right - l.x1;
  // Both sides clearly indented by about the same amount (an indented
  // full-width first line is not centred).
  if (stats.indent && Math.abs(leftGap - stats.indent) < 0.5 * stats.bodyFs && rightGap < (right - left) * 0.25) return false;
  // centred lines in prose are short (titles, scene breaks, epigraph lines);
  // an indented ragged line of a quotation or list is not centred
  if (l.x1 - l.x0 > 0.6 * (right - left)) return false;
  return leftGap > 1.5 * stats.bodyFs && rightGap > 1.5 * stats.bodyFs &&
    Math.abs(leftGap - rightGap) < Math.max(1.5 * stats.bodyFs, 0.05 * (right - left));
}

export function classify(lines, stats) {
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k];
    const prev = lines[k - 1];
    const gapAbove = prev && prev.page === l.page ? l.y - prev.y : Infinity;
    l.centered = isCentered(l, stats);
    l.relSize = l.fs / stats.bodyFs;
    const kind = headingKind(l.text);
    if (isSceneBreak(l.text) && (l.centered || l.text.replace(/\s/g, '').length >= 2)) {
      l.type = 'scene';
    } else if (l.relSize >= 1.15 && l.text.length <= 120 && /\p{L}/u.test(l.text)) {
      l.type = 'heading';
    } else if (l.text.length <= 80 && l.centered && (kind || (l.bold && gapAbove > stats.pitch * 1.5))) {
      l.type = 'heading';
    } else {
      l.type = 'body';
    }
  }
  return lines;
}

// ---------------------------------------------------------- 5. assemble ----

export function assemble(lines, stats, notes, opts = {}) {
  const blocks = [];
  const wordStats = new WordStats();
  for (const l of lines) wordStats.addText(l.text);
  const lang = detectLanguage(lines.slice(0, 3000).map((l) => l.text).join(' ')).lang;
  const ctx = { stats: wordStats, lang, faithful: !!opts.faithful, trace: opts.trace };
  const noteIds = new Map(); // num -> ids (in page order)
  for (const id of notes.keys()) {
    const num = id.split('-')[1];
    if (!noteIds.has(num)) noteIds.set(num, []);
    noteIds.get(num).push(id);
  }
  const indentStyle = stats.indent !== null;
  const blockStyle = stats.paraGap !== null;

  let para = null; // {lines:[], runs:[]}
  const flush = () => {
    if (!para) return;
    const first = para.lines[0];
    const block = {
      type: 'p', runs: para.runs, align: para.lines.length === 1 && first.centered ? 'center' : 'left', page: first.page,
      // look of the paragraph, for user-chosen chapter-title rules
      size: round(first.fs), relSize: first.fs / stats.bodyFs,
      allBold: para.lines.every((l) => l.bold), allItalic: para.lines.every((l) => l.italic),
    };
    if (para.lines.length === 1) {
      const l = para.lines[0];
      const gapAbove = para.gapAbove ?? Infinity;
      block.isolated = l.centered || gapAbove > stats.pitch * 1.6 ? 'strong' : false;
    } else block.isolated = false;
    blocks.push(block);
    para = null;
  };

  const resolveNotes = (runs, page) => {
    const out = [];
    for (const r of runs) {
      if (r.sup && /^\s*\d{1,3}\s*$/.test(r.t)) {
        const num = r.t.trim();
        const id = notes.has(`p${page}-${num}`) ? `p${page}-${num}` : notes.has(`p${page + 1}-${num}`) ? `p${page + 1}-${num}` : (noteIds.get(num)?.length === 1 ? noteIds.get(num)[0] : null);
        if (id) { out.push({ note: id }); continue; }
      }
      out.push(r);
    }
    return out;
  };

  let heading = null;
  const flushHeading = () => {
    if (!heading) return;
    blocks.push({ type: 'p', runs: heading.runs, heading: { level: 1, source: 'format' }, page: heading.page, size: round(heading.fs), relSize: heading.fs / stats.bodyFs, isolated: 'strong', align: heading.centered ? 'center' : 'left', allBold: heading.bold, allItalic: heading.italic });
    heading = null;
  };

  for (let k = 0; k < lines.length; k++) {
    const l = lines[k];
    const prev = lines[k - 1];
    const samePage = prev && prev.page === l.page;
    const gap = samePage ? l.y - prev.y : null;

    if (l.type === 'scene') {
      flush(); flushHeading();
      blocks.push({ type: 'scene' });
      continue;
    }
    if (l.type === 'heading') {
      flush();
      // wrapped heading: same size and style, close below
      if (heading && samePage && Math.abs(heading.fs - l.fs) < 0.6 && heading.italic === l.italic && gap < l.fs * 1.9) {
        joinRunsInto(heading.runs, l.runs, l.text, ctx);
        continue;
      }
      flushHeading();
      heading = { runs: l.runs.map((r) => ({ ...r })), fs: l.fs, centered: l.centered, bold: l.bold, italic: l.italic, page: l.page };
      continue;
    }
    flushHeading();

    const runs = resolveNotes(l.runs, l.page);
    if (!para) {
      para = { lines: [l], runs: runs.map((r) => ({ ...r })), gapAbove: gap ?? Infinity };
      continue;
    }
    const a = para.lines[para.lines.length - 1];
    const { left, right } = stats.margins(l.page);
    const { right: rightA } = stats.margins(a.page);
    const indentB = l.x0 - left;
    const isIndented = indentStyle && indentB > stats.indent * 0.5 && indentB < stats.indent * 2.5 + stats.bodyFs && !l.centered && !l.besideCap;
    const aShort = a.x1 < rightA - 2.5 * stats.bodyFs;
    const aEnds = SENTENCE_END_RE.test(a.text);
    const bStarts = /^[\p{Lu}\p{N}¿¡«“"‘'—–(]/u.test(l.text);
    let breakHere = false;
    if (samePage && gap > (blockStyle ? (stats.pitch + stats.paraGap) / 2 : stats.pitch * 1.3)) {
      // A large gap inside a page with no heading: blank-line scene break?
      const sceneGap = Math.max(stats.pitch * 2.3, (stats.paraGap ?? stats.pitch) + stats.pitch * 0.9);
      if (gap > sceneGap && para) {
        flush();
        blocks.push({ type: 'scene' });
        para = { lines: [l], runs: runs.map((r) => ({ ...r })), gapAbove: gap };
        continue;
      }
      breakHere = true;
    } else if (indentStyle) {
      // An indented block (quotation, letter) has every line at the same
      // indent: only a short previous line ends its paragraph.
      const { left: leftA } = stats.margins(a.page);
      // (lines at exactly the normal paragraph indent are paragraph starts)
      const sameIndent = Math.abs((a.x0 - leftA) - indentB) < 2;
      // (lines at exactly the normal indent can still be a block when they are
      // set smaller than the body text, like a quoted letter)
      const smallerBlock = Math.abs(l.fs - stats.bodyFs) > 0.6 && Math.abs(a.fs - l.fs) < 0.3;
      const blockIndent = sameIndent && (smallerBlock || Math.abs(indentB - stats.indent) > Math.max(3, 0.3 * stats.indent));
      // Lists with a hanging indent ("1. text" then deeper, ragged lines):
      // a deeper or same-indent line without a list marker continues the item.
      const aIndent = a.x0 - leftA;
      const listMarker = /^(?:\d{1,3}[.)]|[•●▪◦‣–—-]|\(?[a-z]\))\s/u.test(l.text);
      const inBlock = aIndent > stats.indent * 0.5 && !listMarker && (blockIndent || indentB > aIndent + 2);
      // Blocks are often indented on the right too, so "short" is unreliable
      // there: a sentence end followed by a capital starts a new paragraph.
      breakHere = inBlock ? aEnds && (aShort || bStarts) : isIndented;
    } else if (blockStyle && !samePage) {
      breakHere = aShort && aEnds && bStarts;
    } else if (!blockStyle) {
      breakHere = aShort && aEnds && bStarts;
    }
    if (a.centered && !l.centered) breakHere = true;
    if (breakHere) {
      flush();
      para = { lines: [l], runs: runs.map((r) => ({ ...r })), gapAbove: gap ?? Infinity };
    } else {
      joinRunsInto(para.runs, runs, l.text, ctx);
      para.lines.push(l);
    }
  }
  flush();
  flushHeading();
  return blocks;
}

/** Full pipeline. */
export function reflow(pages, opts = {}) {
  const warnings = [];
  const pagesLines = pages.map(buildLines);
  // A drop cap that is a word by itself ("I was born…", "A man…") needs a
  // space; "M" + "argot" does not. Decide with the book's own vocabulary.
  const vocab = new WordStats();
  for (const l of pagesLines.flat()) vocab.addText(l.dropCap ? l.text.slice(l.dropCap.length) : l.text);
  for (const l of pagesLines.flat()) {
    if (!l.dropCap) continue;
    const rest = l.text.slice(l.dropCap.length);
    const firstWord = (rest.match(/^[\p{L}’']+/u) || [''])[0];
    const joined = l.dropCap + firstWord;
    if (/^(?:[AIOYEUÀÉ])$/u.test(l.dropCap) && firstWord && !vocab.has(joined) && /^\p{Ll}/u.test(firstWord)) {
      l.runs[0].t += ' ';
      l.text = `${l.dropCap} ${rest}`;
    }
  }
  const all = pagesLines.flat();
  const stats = docStats(all);
  const { lines: kept, notes, removed } = stripFurniture(pagesLines, stats, opts.known || []);
  const lines = classify(kept.flat(), stats);
  // multi-column check: many short body lines starting near the page middle
  const body = lines.filter((l) => l.type === 'body');
  const midStarts = body.filter((l) => l.x0 > l.pageW * 0.45).length;
  if (body.length > 40 && midStarts > body.length * 0.3) {
    warnings.push('This PDF seems to have several columns; the text order may be wrong. The Word file would convert better.');
  }
  const blocks = assemble(lines, stats, notes, opts);
  return { blocks, notes, warnings, debug: { stats, removed } };
}
