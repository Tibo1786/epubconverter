import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pdfjs from '../lib/pdfjs-node.js';
import { headingOptions, matchesRule, fallbackRule } from '../../src/core/headings.js';
import { buildBook } from '../../src/core/structure.js';
import { readManuscript, buildFromRaw } from '../../src/core/convert.js';

const P = (t, extra = {}) => ({ type: 'p', runs: [{ t }], align: 'left', size: 12, ...extra });
const long = (n) => `This is paragraph ${n}, a long stretch of ordinary prose that goes on for a while so that it clearly reads as body text and not as a title of any kind.`;

test('rules match by look', () => {
  assert.ok(matchesRule(P('The Harbour', { allBold: true }), { kind: 'bold' }));
  assert.ok(!matchesRule(P(long(1), { allBold: true }), { kind: 'bold' }), 'long lines are never titles');
  assert.ok(matchesRule(P('THE HARBOUR'), { kind: 'caps' }));
  assert.ok(matchesRule(P('3. El regreso'), { kind: 'number' }));
  assert.ok(matchesRule(P('XII'), { kind: 'number' }));
  assert.ok(matchesRule(P('Uno', { styleName: 'Capitulo' }), { kind: 'style', value: 'Capitulo' }));
  assert.ok(matchesRule(P('Uno', { size: 14 }), { kind: 'size', value: 14 }));
  assert.ok(!matchesRule(P('***', { align: 'center' }), { kind: 'center' }), 'scene breaks are not titles');
});

test('options list what the document contains, with counts and examples', () => {
  const blocks = [];
  for (let k = 1; k <= 5; k++) blocks.push(P(`Title ${k}`, { styleName: 'Capitulo', allBold: true }), P(long(k), { styleName: 'Normal' }), P(long(k + 10), { styleName: 'Normal' }));
  const opts = headingOptions(blocks);
  const style = opts.find((o) => o.id === 'style:Capitulo');
  assert.equal(style.count, 5);
  assert.equal(style.example, 'Title 2');
  assert.ok(opts.find((o) => o.kind === 'bold'));
  assert.ok(!opts.find((o) => o.id === 'style:Normal'), 'body styles are not offered');
});

test('a user-chosen rule replaces automatic detection', () => {
  const blocks = [P('Capítulo 1', { heading: { level: 1, source: 'style' } }), P('Un sueño', { allBold: true }), P(long(1)), P('Otra noche', { allBold: true }), P(long(2))];
  const auto = buildBook(blocks, { lang: 'es' });
  assert.deepEqual(auto.chapters.map((c) => c.title), ['Capítulo 1']);
  const bold = buildBook(blocks, { lang: 'es' }, new Map(), { headingRule: { kind: 'bold' } });
  assert.deepEqual(bold.chapters.map((c) => c.title), ['Inicio', 'Un sueño', 'Otra noche']);
});

test('fallback picks a consistent look only when nothing else was found', () => {
  const blocks = [];
  for (const t of ['The Harbour', 'Salt', 'The Ledger']) blocks.push(P(t, { allBold: true }), P(long(t.length)), P(long(t.length + 1)));
  assert.deepEqual(fallbackRule(blocks)?.kind, 'bold');
  const book = buildBook(blocks, { lang: 'en' });
  assert.deepEqual(book.chapters.map((c) => c.title), ['The Harbour', 'Salt', 'The Ledger']);
  assert.equal(book.headingRule.automatic, true);
  // a stray bold sentence in the text is not enough
  assert.equal(fallbackRule([P(long(1)), P('Really?', { allBold: true }), P(long(2))]), null);
});

test('real files: the bold-titled manuscript offers "bold lines", and rebuilds cheaply with options', async () => {
  const bytes = new Uint8Array(readFileSync(new URL('../fixtures/plain-titles-en.pdf', import.meta.url)));
  const raw = await readManuscript(bytes, 'plain-titles-en.pdf', { pdfjs });
  assert.ok(headingOptions(raw.blocks).some((o) => o.kind === 'bold' && o.count === 4));
  const centred = buildFromRaw(raw, { headingRule: { kind: 'center' } });
  assert.ok(centred.chapters.length <= 2);
  const faithful = buildFromRaw(raw, { faithful: true });
  assert.equal(faithful.chapters.length, 4);
});
