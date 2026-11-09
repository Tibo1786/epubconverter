import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from '../../vendor/fflate/fflate.mjs';
import pdfjs from '../lib/pdfjs-node.js';
import { anonymizeText, buildDiagnosticReport } from '../../src/core/diagnostic.js';
import { readManuscript, buildFromRaw, convertToBook } from '../../src/core/convert.js';
import { reflow } from '../../src/core/pdf/reflow.js';
import { buildBook } from '../../src/core/structure.js';

const fixture = (n) => new Uint8Array(readFileSync(new URL(`../fixtures/${n}`, import.meta.url)));
const SECRET = /Remei|Vilanova|relojes|Clara|Marta|Vidal|abuelo|Besançon|sótano/;

test('anonymizeText keeps shape, common words and chapter words, hides the rest', () => {
  assert.equal(anonymizeText('Capítulo 3'), 'Capítulo 3');
  assert.equal(anonymizeText('CAPÍTULO XII'), 'CAPÍTULO XII');
  assert.equal(anonymizeText('—¿Eres Clara? —preguntó, sin acercarse.'), '—¿Xxxx Xxxxx? —xxxxxxxx, sin xxxxxxxxx.');
  assert.equal(anonymizeText('col·lecció de la casa'), 'xxx·xxxxxx de la xxxx');
  assert.equal(anonymizeText('é conven-'), 'x́ xxxxxx-'); // separate accent mark kept
  assert.match(anonymizeText('Llegué en 1974 a una ciudad que no conocía y que nunca olvidaré.'), /^Xxxxxx en 0000 a una xxxxxx que no xxxxxxx y que xxxxx xxxxxxxx\.$/);
});

test('DOCX report: no manuscript words, and the anonymized file converts to the same structure', async () => {
  const bytes = fixture('novel-es.docx');
  const raw = await readManuscript(bytes, 'novel-es.docx');
  const book = buildFromRaw(raw);
  const zip = unzipSync(buildDiagnosticReport(raw, book, { bytes, note: 'test' }));
  const json = strFromU8(zip['report.json']);
  assert.doesNotMatch(json, SECRET);
  const docxXml = Object.entries(unzipSync(zip['anonymized.docx'])).filter(([n]) => n.endsWith('.xml')).map(([, d]) => strFromU8(d)).join('');
  assert.doesNotMatch(docxXml, SECRET);
  const anon = await convertToBook(zip['anonymized.docx'], 'x.docx', { lang: 'es' });
  assert.equal(anon.chapters.length, book.chapters.length);
  assert.deepEqual(anon.chapters.map((c) => c.blocks.length), book.chapters.map((c) => c.blocks.length));
  assert.equal(anon.chapters[1].title, 'CAPÍTULO 2. Los xxxxxxx');
});

test('PDF report: layout replays to the same paragraphs and chapters', async () => {
  const bytes = fixture('novel-es.pdf');
  const raw = await readManuscript(bytes, 'novel-es.pdf', { pdfjs });
  const book = buildFromRaw(raw);
  const report = JSON.parse(strFromU8(unzipSync(buildDiagnosticReport(raw, book, { bytes }))['report.json']));
  assert.doesNotMatch(JSON.stringify(report), SECRET);
  const pages = report.pdf.pages.map((p) => ({ n: p.n, width: p.w, height: p.h, items: p.items.map(([str, x, y, w, fs, b, i]) => ({ str, x, y, w, fs, bold: !!b, italic: !!i })) }));
  const replay = reflow(pages);
  const rbook = buildBook(replay.blocks, { lang: 'es' }, replay.notes);
  assert.equal(rbook.chapters.length, book.chapters.length);
  assert.deepEqual(rbook.chapters.map((c) => c.blocks.length), book.chapters.map((c) => c.blocks.length));
  assert.ok(report.hyphenation.length > 0, 'hyphenation decisions recorded');
});

test('PDF fragments never leave part of a word readable', () => {
  assert.equal(anonymizeText('so', { cutEnd: true }), 'xx');
  assert.equal(anonymizeText('mething that was', { cutStart: true }), 'xxxxxxx that was');
  assert.equal(anonymizeText('Capítulo 1'), 'Capítulo 1');
});
