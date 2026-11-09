// Orchestrator: file bytes -> book model -> EPUB bytes.
// Pure (no DOM): the same code runs in the browser and in Node tests.

import { readDocx } from './docx.js';
import { readText } from './txt.js';
import { readPdf } from './pdf/reader.js';
import { reflow } from './pdf/reflow.js';
import { buildBook } from './structure.js';

export function sniffType(name, bytes) {
  const lower = (name || '').toLowerCase();
  if (bytes && bytes.length > 4) {
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf'; // %PDF
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) return lower.endsWith('.epub') ? 'epub' : 'docx'; // PK zip
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf) return 'doc'; // OLE2 (.doc)
    if (bytes[0] === 0x7b && bytes[1] === 0x5c && bytes[2] === 0x72) return 'rtf'; // {\rtf
  }
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.text')) return 'txt';
  return 'txt';
}

export function titleFromFilename(name) {
  return (name || 'Manuscript')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const APP_VERSION = '1.2.0';

/**
 * Read a file into raw blocks (the slow part: unzip / pdf.js).
 * The result can be turned into a book many times with buildFromRaw().
 */
export async function readManuscript(bytes, name, opts = {}) {
  const type = sniffType(name, bytes);
  const trace = [];
  let res;
  if (type === 'docx') res = readDocx(bytes);
  else if (type === 'pdf') {
    if (!opts.pdfjs) throw new Error('PDF support is not loaded.');
    res = await readPdf(bytes, opts.pdfjs, { ...opts, trace });
  } else if (type === 'txt') res = readText(bytes, { ...opts, trace });
  else if (type === 'doc') throw new Error('This is an old Word .doc file. Open it in Word, Pages or LibreOffice and save it as .docx, or ask the author for a .docx or PDF.');
  else if (type === 'rtf') throw new Error('RTF files are not supported yet. Open it in Word or LibreOffice and save it as .docx.');
  else throw new Error('Unsupported file type.');
  return { ...res, type, name, trace, faithful: !!opts.faithful };
}

/**
 * Raw blocks -> book. Options: lang, faithful, headingRule.
 * PDF and TXT are re-flowed when `faithful` changes (it affects line joining).
 */
export function buildFromRaw(raw, opts = {}) {
  if (raw.scanned) return { scanned: true, type: raw.type, warnings: raw.warnings, meta: raw.meta, chapters: [] };
  let res = raw;
  if (!!opts.faithful !== raw.faithful) {
    const trace = [];
    if (raw.type === 'pdf') res = { ...raw, ...reflow(raw.pages, { faithful: opts.faithful, trace, known: [raw.meta?.title, raw.meta?.author] }), trace, warnings: raw.warnings };
    else if (raw.type === 'txt') res = { ...raw, ...readText(raw.text, { faithful: opts.faithful, trace }), trace };
  }
  const book = buildBook(res.blocks, { ...res.meta, lang: opts.lang, outline: raw.outline }, res.notes, opts);
  if (!book.meta.title) book.meta.title = titleFromFilename(raw.name);
  book.warnings = [...(res.warnings || []), ...book.warnings];
  book.type = raw.type;
  book.trace = res.trace;
  return book;
}

/**
 * Convert a manuscript into the book model.
 * @param {Uint8Array} bytes
 * @param {string} name file name
 * @param {{pdfjs?: object, onProgress?: Function, lang?: string, faithful?: boolean, headingRule?: object}} opts
 */
export async function convertToBook(bytes, name, opts = {}) {
  return buildFromRaw(await readManuscript(bytes, name, opts), opts);
}
