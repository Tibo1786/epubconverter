// Conversion quality, measured against ground truth for every fixture.
// Thresholds: DOCX/TXT must be exact (with italics/bold); PDF >= 98% of
// paragraphs exact (plain text), and the chapter list must always be exact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import pdfjs from './lib/pdfjs-node.js';
import { convertToBook } from '../src/core/convert.js';
import { measure } from './lib/quality.js';
import { runsText } from '../src/core/typography.js';

const dir = new URL('./fixtures/', import.meta.url);
const fixtures = readdirSync(dir).filter((f) => /\.(docx|pdf|txt)$/.test(f));

for (const name of fixtures) {
  test(`quality: ${name}`, async () => {
    const expected = JSON.parse(readFileSync(new URL(`${name}.expected.json`, dir), 'utf8'));
    const book = await convertToBook(new Uint8Array(readFileSync(new URL(name, dir))), name, { pdfjs });
    if (expected.scanned) {
      assert.equal(book.scanned, true);
      assert.match(book.warnings.join(' '), /scan/i);
      return;
    }
    const isPdf = name.endsWith('.pdf');
    const m = measure(book, expected, { markup: !isPdf });
    const rate = isPdf ? m.paragraphs.plainRate : m.paragraphs.rate;
    const min = isPdf ? 0.98 : 1;
    assert.ok(rate >= min, `${name}: ${(rate * 100).toFixed(1)}% paragraphs exact (min ${min * 100}%). Misses:\n${m.misses.slice(0, 5).join('\n')}\nGot instead:\n${m.extra.slice(0, 5).join('\n')}`);
    assert.deepEqual(m.chapters.got, m.chapters.expected, 'chapter list');
    assert.deepEqual(m.forbidden, [], 'running headers / page numbers left in the text');
    assert.equal(book.meta.title, expected.title);
    assert.equal(book.meta.author, expected.author);
    assert.equal(book.meta.lang, expected.lang);
    expected.chapters.forEach((c, i) => assert.equal(book.chapters[i].lang, c.lang, `language of chapter ${i + 1}`));
    if (expected.notes) {
      assert.deepEqual(book.chapters.flatMap((c) => c.notes.map((n) => runsText(n.runs))), expected.notes, 'footnotes');
    }
    // generic hygiene
    const all = book.chapters.flatMap((c) => c.blocks.filter((b) => b.type === 'p').map((b) => runsText(b.runs))).join('\n');
    assert.doesNotMatch(all, /\p{L}- \p{Ll}/u, 'line-end hyphen left in the middle of a sentence');
    assert.doesNotMatch(all, / {2}/, 'double spaces');
    assert.doesNotMatch(all, /­/, 'soft hyphens');
  });
}
