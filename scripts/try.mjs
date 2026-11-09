// Convert files locally (nothing leaves your machine) and print a quality report.
//   npm run try -- path/to/manuscript.docx [more files...]
// Writes out/<name>.epub. Keep real manuscripts OUTSIDE the repository.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pdfjs from '../test/lib/pdfjs-node.js';
import { convertToBook } from '../src/core/convert.js';
import { buildEpub } from '../src/core/epub.js';
import { runsText } from '../src/core/typography.js';
import { report } from '../src/core/report.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'out'), { recursive: true });
const files = process.argv.slice(2);
if (!files.length) { console.error('usage: npm run try -- <file> [...]'); process.exit(2); }
for (const f of files) {
  const t0 = Date.now();
  const book = await convertToBook(new Uint8Array(readFileSync(f)), basename(f), { pdfjs });
  console.log(`\n== ${basename(f)}  (${Date.now() - t0} ms)`);
  if (book.scanned) { console.log('SCANNED:', book.warnings.join(' ')); continue; }
  const r = report(book);
  console.log(`title: ${book.meta.title} | author: ${book.meta.author} | lang: ${book.meta.lang}`);
  console.log(`chapters: ${r.chapters}  paragraphs: ${r.paragraphs}  scene breaks: ${r.scenes}  notes: ${r.notes}  words: ${r.words}`);
  for (const w of book.warnings) console.log('warning:', w);
  for (const c of book.chapters) console.log(`  ${c.level === 2 ? '  ' : ''}- ${c.title}${c.lang ? ` [${c.lang}]` : ''} (${c.blocks.length} blocks)`);
  if (r.suspicious.length) {
    console.log('possible reflow problems:');
    for (const s of r.suspicious.slice(0, 15)) console.log('  ?', s);
  }
  const out = join(root, 'out', basename(f).replace(/\.([^.]+)$/, '-$1') + '.epub');
  writeFileSync(out, buildEpub(book, { confidential: process.env.CONFIDENTIAL }));
  console.log('wrote', out);
  void runsText;
}
