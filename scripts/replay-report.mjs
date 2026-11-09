// Replay a privacy-safe problem report through the converter.
//   node scripts/replay-report.mjs manuscript-problem-report-2026-11-09.zip [--faithful] [--rule bold|caps|center|number|style:<name>|size:<pt>]
// Prints what the converter makes of the (anonymised) layout, so the problem
// can be reproduced, fixed, and turned into a synthetic regression fixture.
import { readFileSync } from 'node:fs';
import { rawFromReport } from '../src/core/diagnostic.js';
import { convertToBook } from '../src/core/convert.js';
import { reflow } from '../src/core/pdf/reflow.js';
import { readText } from '../src/core/txt.js';
import { buildBook } from '../src/core/structure.js';
import { headingOptions } from '../src/core/headings.js';
import { report as quality } from '../src/core/report.js';
import { runsText } from '../src/core/typography.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && !/^(bold|caps|center|number|style:|size:)/.test(a));
if (!file) { console.error('usage: node scripts/replay-report.mjs <report.zip> [--faithful] [--rule <rule>]'); process.exit(2); }
const faithful = args.includes('--faithful');
const ruleArg = args[args.indexOf('--rule') + 1];
const headingRule = args.includes('--rule') ? (ruleArg.includes(':') ? { kind: ruleArg.split(':')[0], value: ruleArg.split(':')[0] === 'size' ? Number(ruleArg.split(':')[1]) : ruleArg.split(':').slice(1).join(':') } : { kind: ruleArg }) : null;

const { report, docx } = file.endsWith('.json')
  ? { report: JSON.parse(readFileSync(file, 'utf8')), docx: null }
  : rawFromReport(new Uint8Array(readFileSync(file)));
console.log(`report v${report.formatVersion} from app ${report.appVersion} (${report.created}), input ${report.input.type}, ${report.input.pages ?? '?'} pages`);
if (report.note) console.log(`note: "${report.note}"`);
console.log('settings when sent:', JSON.stringify(report.settings));
const opts = { faithful, headingRule, lang: report.settings?.lang };

let book, blocks;
if (report.input.type === 'docx' && docx) {
  book = await convertToBook(docx, 'report.docx', opts);
} else if (report.input.type === 'pdf' && report.pdf) {
  const pages = report.pdf.pages.map((p) => ({ n: p.n, width: p.w, height: p.h, items: p.items.map(([str, x, y, w, fs, b, i]) => ({ str, x, y, w, fs, bold: !!b, italic: !!i })) }));
  const r = reflow(pages, { faithful });
  blocks = r.blocks;
  book = buildBook(r.blocks, { lang: opts.lang, langHint: report.pdf.meta?.langHint, outline: report.pdf.outline }, r.notes, opts);
  console.log('bookmarks:', (report.pdf.outline || []).length);
  console.log('layout stats:', JSON.stringify({ bodyFs: r.debug.stats.bodyFs, pitch: r.debug.stats.pitch, indent: r.debug.stats.indent, paraGap: r.debug.stats.paraGap }));
  console.log('removed as headers/footers:', [...new Set(r.debug.removed)].slice(0, 12));
} else if (report.input.type === 'txt' && report.txt) {
  const r = readText(report.txt, { faithful });
  blocks = r.blocks;
  book = buildBook(r.blocks, { lang: opts.lang }, r.notes, opts);
} else {
  console.log('result when sent:', JSON.stringify(report.result).slice(0, 400));
  process.exit(0);
}
const q = quality(book);
console.log(`\nchapters ${q.chapters} · paragraphs ${q.paragraphs} · scenes ${q.scenes} · notes ${q.notes}${book.headingRule ? ` · rule ${JSON.stringify(book.headingRule)}` : ''}`);
for (const c of book.chapters) console.log(`  - ${c.title} (${c.blocks.length} blocks)`);
if (blocks) console.log('chapter-title options:', headingOptions(blocks).map((o) => `${o.id}=${o.count}`).join(', ') || 'none');
for (const s of q.suspicious.slice(0, 10)) console.log('  ?', s);
const reasons = {};
for (const h of report.hyphenation || []) reasons[h.reason] = (reasons[h.reason] ?? 0) + 1;
console.log('hyphen decisions when sent:', JSON.stringify(reasons));
console.log('\nfirst paragraphs:');
for (const b of book.chapters.flatMap((c) => c.blocks).filter((b) => b.type === 'p').slice(0, 5)) console.log('  ', runsText(b.runs).slice(0, 140));
