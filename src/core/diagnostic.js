// Privacy-safe problem report.
//
// Builds, on the device, a .zip that describes the LAYOUT of a manuscript
// with its text made unreadable: every letter becomes x / X. Kept as is:
// punctuation, digits in short lines (chapter numbers, page numbers), accents
// drawn as separate marks, and a fixed list of very common words (articles,
// prepositions...) and chapter words ("Capítulo", "Chapter"), which reveal
// nothing about the story but let language and chapter detection be
// reproduced. Fonts, sizes, positions and Word styles are kept.
//
// The developer can replay the report through the converter
// (scripts/replay-report.mjs) and turn it into a regression test.

import { unzipSync, zipSync, strFromU8, strToU8 } from '../../vendor/fflate/fflate.mjs';
import { decodeEntities } from './xml.js';
import { LISTS } from './lang.js';
import { runsText } from './typography.js';

const STRUCTURE_WORDS = [
  'capítulo', 'capitulo', 'capítol', 'capitol', 'chapter', 'chapitre', 'parte', 'part', 'partie', 'libro', 'llibre', 'book', 'livre',
  'prólogo', 'prologo', 'pròleg', 'proleg', 'prologue', 'epílogo', 'epilogo', 'epíleg', 'epileg', 'epilogue', 'épilogue',
  'interludio', 'interludi', 'interlude', 'introducción', 'introducció', 'introduction', 'prefacio', 'prefaci', 'préface', 'preface',
  'nota', 'note', 'agradecimientos', 'agraïments', 'acknowledgements', 'remerciements', 'página', 'pàgina', 'page',
  'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'primero', 'primera', 'segundo', 'segunda', 'tercero', 'tercera',
  'primer', 'segon', 'segona', 'tercer', 'quatre', 'cinc', 'sis', 'set', 'vuit', 'nou', 'deu',
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'first', 'second', 'third',
  'premier', 'première', 'deux', 'trois', 'quatre', 'cinq', 'huit', 'neuf', 'dix',
];
// very short function words missing from the language lists
const COMMON = ['de', 'a', 'o', 'u', 'e', 'y', 'i', 'à', 'ou', 'of', 'd', 'l', 's', 'n', 'm', 't', 'j', 'qu', 'na', 'ni', 'si'];
const KEEP = new Set([...Object.values(LISTS).flatMap((l) => l.split(' ')), ...STRUCTURE_WORDS, ...COMMON]);
const ROMAN = /^[IVXLCDM]{1,7}$/;

/**
 * Make text unreadable while keeping its shape.
 * `cutStart` / `cutEnd`: this PDF text item continues a word from the item
 * before / into the item after, so the word at that edge is always masked,
 * even if it looks like a common word ("so" + "mething" must not leave "so").
 */
export function anonymizeText(s, { cutStart = false, cutEnd = false } = {}) {
  if (!s) return s;
  const short = s.trim().length <= 40;
  return s
    .replace(/[\p{L}\p{M}]+/gu, (w, offset) => {
      const atEdge = (cutStart && offset === 0) || (cutEnd && offset + w.length === s.length);
      if (!atEdge && KEEP.has(w.toLowerCase())) return w;
      if (short && ROMAN.test(w)) return w;
      return w.replace(/\p{Lu}/gu, 'X').replace(/\p{Ll}|\p{Lo}|\p{Lt}|\p{Lm}/gu, 'x');
    })
    .replace(/\d/g, (d) => (short ? d : '0'));
}

const escXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escXml(s).replace(/"/g, '&quot;');

/** A .docx with every text node anonymised; markup, styles and layout intact. */
export function anonymizeDocx(bytes) {
  const files = unzipSync(bytes);
  const out = {};
  for (const [name, data] of Object.entries(files)) {
    if (/^word\/(media|embeddings)\//.test(name) || /\.(png|jpe?g|gif|bmp|tiff?|emf|wmf|svg|bin)$/i.test(name)) {
      out[name] = new Uint8Array(0); // images and embedded files: emptied
      continue;
    }
    if (!/\.(xml|rels)$/i.test(name)) { out[name] = data; continue; }
    let xml = strFromU8(data);
    if (/^word\//.test(name) && name.endsWith('.xml')) {
      xml = xml.replace(/(<w:(t|delText|instrText)\b[^>]*>)([^<]*)(<\/w:\2>)/g, (m, open, tag, text, close) => open + escXml(anonymizeText(decodeEntities(text))) + close);
      xml = xml.replace(/\b(w:author|w:initials|w:userId|w15:userId|w15:providerId)="([^"]*)"/g, (m, a, v) => `${a}="${escAttr(anonymizeText(v))}"`);
      // comment and people parts can hold names in other attributes too
      if (/people\.xml$/.test(name)) xml = xml.replace(/="([^"]*)"/g, (m, v) => `="${escAttr(anonymizeText(v))}"`);
    } else if (/^docProps\//.test(name)) {
      xml = xml.replace(/>([^<]+)</g, (m, text) => `>${escXml(anonymizeText(decodeEntities(text)))}<`);
    } else if (/_rels\/.*\.rels$/.test(name)) {
      xml = xml.replace(/Target="(https?:|mailto:)[^"]*"/g, 'Target="https://example.invalid/"');
    }
    out[name] = strToU8(xml);
  }
  return zipSync(out, { level: 6 });
}

function anonRuns(runs) {
  return (runs || []).map((r) => {
    if (r.t === undefined) return r.note !== undefined || r.n !== undefined ? { note: true } : { br: true };
    const o = { t: anonymizeText(r.t) };
    if (r.i) o.i = 1;
    if (r.b) o.b = 1;
    if (r.sup) o.sup = 1;
    return o;
  });
}

/** Which PDF items continue a word into their neighbour (no gap between them). */
function markCuts(items) {
  const out = items.map((it) => ({ it, cut: { cutStart: false, cutEnd: false } }));
  const order = [...out].sort((a, b) => a.it.y - b.it.y || a.it.x - b.it.x);
  for (let k = 0; k + 1 < order.length; k++) {
    const a = order[k].it, b = order[k + 1].it;
    if (Math.abs(a.y - b.y) > 0.3 * Math.max(a.fs, b.fs)) continue;
    const gap = b.x - (a.x + a.w);
    if (gap < 0.17 * Math.min(a.fs, b.fs) && /\p{L}$/u.test(a.str) && /^\p{L}/u.test(b.str)) {
      order[k].cut.cutEnd = true;
      order[k + 1].cut.cutStart = true;
    }
  }
  return out;
}

/**
 * @param {object} raw  result of readManuscript()
 * @param {object} book result of buildFromRaw()
 * @param {{note?: string, settings?: object, version?: string, bytes?: Uint8Array}} extra
 * @returns {Uint8Array} the report .zip
 */
export function buildDiagnosticReport(raw, book, extra = {}) {
  const report = {
    format: 'manuscript-reader-layout-report',
    formatVersion: 1,
    appVersion: extra.version,
    created: new Date().toISOString().slice(0, 10),
    note: extra.note || '',
    settings: extra.settings || {},
    input: { type: raw.type, size: extra.bytes?.length, pages: raw.pages?.length },
    result: book.scanned ? { scanned: true } : {
      lang: book.meta?.lang,
      warnings: book.warnings,
      headingRule: book.headingRule || null,
      chapters: book.chapters.map((c) => ({
        title: anonymizeText(c.title),
        level: c.level,
        lang: c.lang,
        blocks: c.blocks.map((b) => (b.type === 'scene' ? { scene: 1 } : { runs: anonRuns(b.runs), lang: b.lang })),
        notes: (c.notes || []).length,
      })),
    },
    // line-end hyphen decisions, so "changed words" can be traced
    hyphenation: (book.trace || raw.trace || []).map((t) => ({ left: anonymizeText(t.left), right: anonymizeText(t.right), join: t.join, reason: t.reason })),
  };
  if (raw.type === 'pdf' && raw.pages) {
    report.pdf = {
      meta: { langHint: raw.meta?.langHint },
      // per page: size and every text item [text, x, y, width, fontSize, bold, italic]
      pages: raw.pages.map((p) => ({ n: p.n, w: Math.round(p.width * 10) / 10, h: Math.round(p.height * 10) / 10,
        items: markCuts(p.items).map(({ it, cut }) => [anonymizeText(it.str, cut), +it.x.toFixed(2), +it.y.toFixed(2), +it.w.toFixed(2), +it.fs.toFixed(2), it.bold ? 1 : 0, it.italic ? 1 : 0]) })),
    };
  }
  if (raw.type === 'txt' && raw.text) report.txt = anonymizeText(raw.text);
  const files = { 'report.json': strToU8(JSON.stringify(report, null, 1)) };
  if (raw.type === 'docx' && extra.bytes) files['anonymized.docx'] = anonymizeDocx(extra.bytes);
  files['README.txt'] = strToU8(
    'Manuscript Reader problem report.\n\n' +
    'Every letter of the manuscript has been replaced by x or X. What remains is the\n' +
    'layout (fonts, sizes, positions, Word styles), punctuation, chapter words such as\n' +
    '"Capítulo", and very common short words (de, la, the, and...).\n' +
    'Open report.json (and anonymized.docx for Word files) to check before sending.\n');
  return zipSync(files, { level: 6 });
}

/** Reconstruct raw input from a report (developer side, for replay/tests). */
export function rawFromReport(zipBytes) {
  const files = unzipSync(zipBytes);
  const report = JSON.parse(strFromU8(files['report.json']));
  return { report, docx: files['anonymized.docx'] || null };
}

export { runsText };
