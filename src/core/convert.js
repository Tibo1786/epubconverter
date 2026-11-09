// Orchestrator: file bytes -> book model -> EPUB bytes.
// Pure (no DOM): the same code runs in the browser and in Node tests.

import { readDocx } from './docx.js';
import { readText } from './txt.js';
import { readPdf } from './pdf/reader.js';
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

/**
 * Convert a manuscript into the book model.
 * @param {Uint8Array} bytes
 * @param {string} name file name
 * @param {{pdfjs?: object, onProgress?: Function, lang?: string}} opts
 */
export async function convertToBook(bytes, name, opts = {}) {
  const type = sniffType(name, bytes);
  let res;
  if (type === 'docx') res = readDocx(bytes);
  else if (type === 'pdf') {
    if (!opts.pdfjs) throw new Error('PDF support is not loaded.');
    res = await readPdf(bytes, opts.pdfjs, opts);
  } else if (type === 'txt') res = readText(bytes);
  else if (type === 'doc') throw new Error('This is an old Word .doc file. Open it in Word, Pages or LibreOffice and save it as .docx, or ask the author for a .docx or PDF.');
  else if (type === 'rtf') throw new Error('RTF files are not supported yet. Open it in Word or LibreOffice and save it as .docx.');
  else throw new Error('Unsupported file type.');

  if (res.scanned) {
    return { scanned: true, type, warnings: res.warnings, meta: res.meta, chapters: [] };
  }
  const book = buildBook(res.blocks, { ...res.meta, lang: opts.lang }, res.notes);
  if (!book.meta.title) book.meta.title = titleFromFilename(name);
  book.warnings = [...(res.warnings || []), ...book.warnings];
  book.type = type;
  return book;
}
