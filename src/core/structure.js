// From raw blocks (any reader) to a book: chapters, scene breaks, notes,
// front matter, languages. Shared by DOCX, PDF and TXT.
//
// Raw block shapes produced by readers:
//   {type:'p', runs, align?, heading?:{level, source}, relSize?, allBold?,
//    allItalic?, titleStyle?, subtitleStyle?, pageBreakBefore?, isolated?}
//   {type:'blank'}   empty paragraph (DOCX)
//   {type:'scene'}   scene break already recognised by the reader

import { headingKind, isSceneBreak, SENTENCE_END_RE } from './patterns.js';
import { normalizeRuns, runsText } from './typography.js';
import { detectLanguage, LANGS } from './lang.js';

const UNTITLED = { es: 'Inicio', ca: 'Inici', en: 'Beginning', fr: 'Début' };

const norm = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function textOf(b) {
  return b.type === 'p' ? runsText(b.runs).trim() : '';
}

/** Pick the document language: detection first, metadata as tie-break. */
export function chooseLanguage(blocks, hint) {
  let sample = '';
  for (const b of blocks) {
    if (b.type !== 'p') continue;
    sample += ' ' + runsText(b.runs);
    if (sample.length > 30000) break;
  }
  const d = detectLanguage(sample);
  if (d.lang && (d.confidence > 0.15 || !hint || !LANGS.includes(hint))) return d.lang;
  if (hint && LANGS.includes(hint)) return hint;
  return d.lang || hint || 'en';
}

/** Turn empty paragraphs into scene breaks when the author uses them that way. */
function resolveBlanks(blocks) {
  // Gaps between consecutive paragraphs, and how many blanks each has.
  const gaps = [];
  let blanks = 0;
  let seenP = false;
  for (const b of blocks) {
    if (b.type === 'blank') { blanks++; continue; }
    if (b.type === 'p' && !b.heading) {
      if (seenP) gaps.push(blanks);
      seenP = true;
    } else seenP = false;
    blanks = 0;
  }
  const withBlank = gaps.filter((g) => g >= 1).length;
  const ratio = gaps.length ? withBlank / gaps.length : 0;
  // Authors who never leave blank lines: one blank line = scene break.
  // Authors who separate every paragraph with blank lines: 2+ = scene break
  // (only if that is rare).
  let threshold;
  if (ratio < 0.35) threshold = 1;
  else {
    const multi = gaps.filter((g) => g >= 2).length;
    threshold = multi / Math.max(1, gaps.length) < 0.15 ? 2 : Infinity;
  }
  const out = [];
  let run = 0;
  for (const b of blocks) {
    if (b.type === 'blank') { run++; continue; }
    if (run >= threshold && out.length && out[out.length - 1].type === 'p' && !out[out.length - 1].heading && b.type === 'p' && !b.heading && !b.pageBreakBefore) {
      out.push({ type: 'scene' });
    }
    run = 0;
    out.push(b);
  }
  return out;
}

function isSubtitleCandidate(b, prevHeading) {
  if (b.type !== 'p') return false;
  const t = textOf(b);
  if (!t || t.length > 80) return false;
  if (b.heading && headingKind(t) !== 'chapter' && headingKind(t) !== 'part') return true;
  if (b.subtitleStyle) return true;
  if (SENTENCE_END_RE.test(t) && !/[»”’"')\]]$/.test(t)) return false;
  // Centred short line directly after a heading (typed subtitle).
  return b.align === 'center' && prevHeading && (b.allItalic || b.allBold || (b.relSize ?? 1) > 1.05 || t.split(/\s+/).length <= 8);
}

function joinTitle(a, b) {
  return /[.:;—–-]$/.test(a) ? `${a} ${b}` : `${a}. ${b}`;
}

/**
 * @param {object[]} rawBlocks
 * @param {{title?, author?, langHint?, lang?}} meta
 * @param {Map<string, object[]>} notes  note id -> runs
 */
export function buildBook(rawBlocks, meta = {}, notes = new Map()) {
  const lang = meta.lang || chooseLanguage(rawBlocks, meta.langHint);
  const warnings = [];

  // 1. typography + scene breaks typed as symbols
  let blocks = [];
  for (const b of rawBlocks) {
    if (b.type !== 'p') { blocks.push(b); continue; }
    const runs = normalizeRuns(b.runs, lang);
    const t = runsText(runs).trim();
    if (!t && !runs.some((r) => r.note !== undefined)) { blocks.push({ type: 'blank' }); continue; }
    if (isSceneBreak(t) && !b.heading) { blocks.push({ type: 'scene' }); continue; }
    blocks.push({ ...b, runs });
  }
  blocks = resolveBlanks(blocks);

  // 2. headings: reader hints + wording
  for (const b of blocks) {
    if (b.type !== 'p') continue;
    const t = textOf(b);
    const kind = headingKind(t);
    if (b.heading) {
      b.kind = kind ?? 'titled';
    } else if (kind === 'chapter' || kind === 'part') {
      if (t.length <= 70 && (b.isolated !== false)) { b.heading = { level: 1, source: 'pattern' }; b.kind = kind; }
    } else if (kind === 'number' && (b.align === 'center' || b.isolated === 'strong')) {
      b.heading = { level: 1, source: 'pattern' };
      b.kind = 'number';
    }
  }

  // 3. merge heading + subtitle; a part followed by a chapter stays separate
  const merged = [];
  for (let k = 0; k < blocks.length; k++) {
    const b = blocks[k];
    if (b.type === 'p' && b.heading) {
      let title = textOf(b);
      let kind = b.kind;
      const h = { type: 'h', title, kind, source: b.heading.source, titleStyle: b.titleStyle, runs: b.runs };
      // look ahead for subtitle(s)
      while (k + 1 < blocks.length) {
        const n = blocks[k + 1];
        if (n.type !== 'p') break;
        const nt = textOf(n);
        const nk = headingKind(nt);
        if (nk === 'chapter' || nk === 'part' || (nk === 'number' && n.heading)) break;
        if (!isSubtitleCandidate(n, true)) break;
        const chapterish = kind === 'chapter' || kind === 'number' || kind === 'part';
        const nestedStyle = n.heading && b.heading.source === 'style' && n.heading.source === 'style' && n.heading.level > b.heading.level;
        const sizeStep = n.heading && b.heading.source === 'format' && (n.relSize ?? 1) < (b.relSize ?? 1) - 0.1 && chapterish;
        if (!chapterish && !nestedStyle && !sizeStep) break;
        // A wrapped long heading (same formatting) joins with a space.
        const sameLook = n.heading && b.heading && n.heading.source === b.heading.source && n.wrapOf === b;
        title = sameLook ? `${title} ${nt}` : joinTitle(title, nt);
        k++;
        if (nt.length > 0) break;
      }
      h.title = title;
      merged.push(h);
    } else {
      merged.push(b);
    }
  }
  blocks = merged;

  // 4. front matter (title page typed into the manuscript)
  const metaOut = { title: meta.title || null, author: meta.author || null, lang };
  const isChapterHeading = (b) => b.type === 'h' && (b.kind === 'chapter' || b.kind === 'part' || b.kind === 'number');
  let first = blocks.findIndex((b) => b.type === 'h' && !b.titleStyle);
  const byRe = /^(?:by|por|de|per|par|von)\s+(\p{Lu}.+)$/iu;
  // contact / submission lines of a manuscript title page (short lines only)
  const contactRe = /@|https?:|www\.|\+?\d[\d\s().-]{7,}\d|\d[\d.,\s]*\s*(?:palabras|words|mots|paraules)\b|^(?:novela|novel|roman|novel·la|manuscrito|manuscript|manuscrit|agente|agent|agencia|agency)\b|copyright|©/iu;
  const looksLikeName = (t) => t.length <= 60 && t.split(/\s+/).length <= 6 && /^\p{Lu}/u.test(t) && !/[.!?:;]$/.test(t) && !/\d/.test(t);
  // Headings on a typed title page (book title, author) are not chapters.
  while (first >= 0 && !isChapterHeading(blocks[first])) {
    const h = blocks[first];
    const nextH = blocks.findIndex((b, i) => i > first && b.type === 'h');
    if (nextH < 0) break;
    const between = blocks.slice(first + 1, nextH);
    const shortBetween = between.every((b) => b.type !== 'p' || textOf(b).length <= 150) &&
      between.reduce((a, b) => a + textOf(b).length, 0) <= 400;
    const n = norm(h.title);
    const chaptersFollow = blocks.slice(nextH).some(isChapterHeading);
    const isTitle = (metaOut.title && n === norm(metaOut.title)) || (!metaOut.title && shortBetween && chaptersFollow);
    const isAuthor = (metaOut.author && n === norm(metaOut.author)) || (!metaOut.author && metaOut.title && shortBetween && chaptersFollow && looksLikeName(h.title));
    if (!isTitle && !isAuthor) break;
    if (isTitle && !metaOut.title) metaOut.title = h.title;
    if (isAuthor && !metaOut.author) metaOut.author = h.title;
    h.frontMatter = true;
    first = nextH;
  }
  if (first < 0) first = blocks.length;
  const leading = blocks.slice(0, first);
  let k = 0;
  let lastDropped = null;
  while (k < leading.length) {
    const b = leading[k];
    if (b.type === 'h' && b.frontMatter) { lastDropped = 'title'; k++; continue; }
    if (b.type !== 'p') { k++; continue; }
    const t = textOf(b);
    if (t.length > 120) break;
    const n = norm(t);
    const by = t.match(byRe);
    if (b.titleStyle) {
      if (!metaOut.title) metaOut.title = t;
      lastDropped = 'title';
    } else if (metaOut.title && n === norm(metaOut.title)) {
      lastDropped = 'title';
    } else if (metaOut.author && (n === norm(metaOut.author) || (by && norm(by[1]) === norm(metaOut.author)))) {
      lastDropped = 'author';
    } else if (by && looksLikeName(by[1])) {
      if (!metaOut.author) metaOut.author = by[1].trim();
      lastDropped = 'author';
    } else if (!metaOut.title && k === 0 && t.length <= 80 && !SENTENCE_END_RE.test(t) && leading.length > 1) {
      metaOut.title = t;
      lastDropped = 'title';
    } else if (lastDropped === 'title' && !metaOut.author && looksLikeName(t)) {
      metaOut.author = t;
      lastDropped = 'author';
    } else if (t.length <= 80 && contactRe.test(t)) {
      lastDropped = 'contact';
    } else break;
    k++;
  }
  const opening = leading.slice(k).filter((b) => b.type === 'p' || b.type === 'scene');

  // 5. chapters
  const hasParts = blocks.some((b) => b.type === 'h' && b.kind === 'part');
  const chapters = [];
  const trimScenes = (bs) => {
    while (bs.length && bs[0].type === 'scene') bs.shift();
    while (bs.length && bs[bs.length - 1].type === 'scene') bs.pop();
    return bs;
  };
  if (opening.length) {
    chapters.push({ title: first >= blocks.length ? (metaOut.title || UNTITLED[lang]) : UNTITLED[lang], level: 1, blocks: trimScenes(opening), untitled: true });
  }
  let cur = null;
  for (let k = first; k < blocks.length; k++) {
    const b = blocks[k];
    if (b.type === 'h') {
      if (b.frontMatter) continue;
      cur = { title: b.title, level: hasParts && b.kind !== 'part' ? 2 : 1, blocks: [] };
      chapters.push(cur);
    } else if (b.type === 'p' || b.type === 'scene') {
      if (!cur) { cur = { title: UNTITLED[lang], level: 1, blocks: [], untitled: true }; chapters.push(cur); }
      cur.blocks.push(b.type === 'p' ? { type: 'p', runs: b.runs } : { type: 'scene' });
    }
  }
  for (const c of chapters) trimScenes(c.blocks);
  // Drop empty untitled chapters
  const finalChapters = chapters.filter((c) => c.blocks.length || !c.untitled);

  if (!blocks.some((b) => b.type === 'h' && !b.frontMatter)) {
    warnings.push('No chapter headings were found, so the book has a single section.');
  }

  // 6. languages per chapter / paragraph
  for (const c of finalChapters) {
    const text = c.blocks.filter((b) => b.type === 'p').map((b) => runsText(b.runs)).join(' ');
    if (text.length >= 150) {
      const d = detectLanguage(text);
      if (d.lang && d.lang !== lang && d.confidence > 0.3) c.lang = d.lang;
    }
    const clang = c.lang || lang;
    for (const b of c.blocks) {
      if (b.type !== 'p') continue;
      const t = runsText(b.runs);
      if (t.length < 160) continue;
      const d = detectLanguage(t);
      if (d.lang && d.lang !== clang && d.confidence > 0.5) b.lang = d.lang;
    }
  }

  // 7. notes: renumber in order of first reference, attach to chapter
  let n = 0;
  const seen = new Map();
  for (const c of finalChapters) {
    c.notes = [];
    for (const b of c.blocks) {
      if (b.type !== 'p') continue;
      for (const r of b.runs) {
        if (r.note === undefined) continue;
        if (!seen.has(r.note)) {
          const runs = notes.get(r.note);
          if (!runs) continue;
          n++;
          seen.set(r.note, n);
          c.notes.push({ n, runs: normalizeRuns(runs, c.lang || lang) });
        }
        r.n = seen.get(r.note);
      }
      b.runs = b.runs.filter((r) => r.note === undefined || r.n !== undefined);
    }
  }

  return { meta: metaOut, chapters: finalChapters, warnings };
}
