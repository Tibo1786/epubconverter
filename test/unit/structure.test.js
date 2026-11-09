import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBook } from '../../src/core/structure.js';
import { runsText } from '../../src/core/typography.js';

const P = (t, extra = {}) => ({ type: 'p', runs: [{ t }], align: 'left', ...extra });
const B = { type: 'blank' };
const long = (n) => `Frase número ${n} de un párrafo de prueba que es bastante largo para parecer real y tiene muchas palabras en español.`;
const flat = (book) => book.chapters.map((c) => [c.title, ...c.blocks.map((b) => (b.type === 'scene' ? '<scene>' : runsText(b.runs)))]);

test('single blank paragraphs are scene breaks when the author never leaves blank lines', () => {
  const book = buildBook([P('Capítulo 1', { heading: { level: 1, source: 'style' } }), P(long(1)), P(long(2)), P(long(3)), B, P(long(4)), P(long(5)), P(long(6)), P(long(7))], { lang: 'es' });
  assert.deepEqual(flat(book)[0], ['Capítulo 1', long(1), long(2), long(3), '<scene>', long(4), long(5), long(6), long(7)]);
});

test('when every paragraph is separated by a blank line, only double blanks are scene breaks', () => {
  const blocks = [P('Capítulo 1', { heading: { level: 1, source: 'style' } })];
  for (let k = 0; k < 10; k++) blocks.push(P(long(k)), B);
  blocks.splice(8, 0, B); // one double blank
  const book = buildBook(blocks, { lang: 'es' });
  assert.equal(book.chapters[0].blocks.filter((b) => b.type === 'scene').length, 1);
});

test('heading + subtitle merge; part > chapter nesting', () => {
  const book = buildBook([
    P('Primera parte', { heading: { level: 1, source: 'style' } }),
    P('Capítulo 1', { heading: { level: 1, source: 'style' } }),
    P('La llegada', { heading: { level: 2, source: 'style' } }),
    P(long(1)),
    P('CAPÍTULO 2', { heading: { level: 1, source: 'format' }, align: 'center' }),
    P('Los relojes', { align: 'center', allItalic: true }),
    P(long(2)),
  ], { lang: 'es' });
  assert.deepEqual(book.chapters.map((c) => [c.title, c.level]), [['Primera parte', 1], ['Capítulo 1. La llegada', 2], ['CAPÍTULO 2. Los relojes', 2]]);
});

test('chapter headings found by wording alone (no styles)', () => {
  const book = buildBook([P(long(0)), P('Capítol primer'), P(long(1)), P('Capítol segon'), P(long(2))], { lang: 'ca' });
  assert.deepEqual(book.chapters.map((c) => c.title), ['Inici', 'Capítol primer', 'Capítol segon']);
});

test('typed title page is front matter: harvested and dropped', () => {
  const book = buildBook([P('El far', { titleStyle: true }), P('per Jordi Serra'), P('jordi@example.com'), P('Capítol 1', { heading: { level: 1, source: 'style' } }), P(long(1))], {});
  assert.equal(book.meta.title, 'El far');
  assert.equal(book.meta.author, 'Jordi Serra');
  assert.deepEqual(flat(book), [['Capítol 1', long(1)]]);
});

test('a title "heading" on the first page is not a chapter', () => {
  const book = buildBook([P('La casa de los relojes', { heading: { level: 1, source: 'format' } }), P('Marta Vidal', { align: 'center' }), P('Capítulo 1', { heading: { level: 1, source: 'format' } }), P(long(1))], {});
  assert.equal(book.meta.title, 'La casa de los relojes');
  assert.deepEqual(book.chapters.map((c) => c.title), ['Capítulo 1']);
});

test('no headings: one section, a warning, title lines dropped', () => {
  const book = buildBook([P('Mi novela'), P(long(1)), P(long(2))], { title: 'Mi novela', lang: 'es' });
  assert.equal(book.chapters.length, 1);
  assert.equal(book.chapters[0].blocks.length, 2);
  assert.ok(book.warnings.length);
});

test('notes are renumbered in reading order and attached to their chapter', () => {
  const notes = new Map([['f7', [{ t: 'Segunda.' }]], ['f3', [{ t: 'Primera.' }]]]);
  const book = buildBook([
    P('Capítulo 1', { heading: { level: 1, source: 'style' } }),
    { type: 'p', runs: [{ t: 'Uno' }, { note: 'f3' }, { t: ' y dos' }, { note: 'f7' }, { t: '.' }] },
  ], { lang: 'es' }, notes);
  const ch = book.chapters[0];
  assert.deepEqual(ch.notes.map((n) => [n.n, runsText(n.runs)]), [[1, 'Primera.'], [2, 'Segunda.']]);
  assert.deepEqual(ch.blocks[0].runs.filter((r) => r.n).map((r) => r.n), [1, 2]);
});

test('a chapter in another language is tagged', () => {
  const en = 'I am writing from the same window where we used to watch the ferries leave for France, and I am thinking of the summer we spent pretending that the war was something happening to other people. You told me once that the sea never steals anything.';
  const ca = 'Feia tres dies que bufava la tramuntana i el poble semblava haver-se encongit sobre si mateix. Les barques estaven amarrades amb dobles caps, les finestres tancades amb balda i els gats havien desaparegut, com fan sempre que el vent decideix que el món li pertany.';
  const book = buildBook([P('Capítol 1', { heading: { level: 1, source: 'style' } }), P(ca), P(ca), P('Letter', { heading: { level: 1, source: 'style' } }), P(en)], {});
  assert.equal(book.meta.lang, 'ca');
  assert.equal(book.chapters[1].lang, 'en');
});

test('bookmarks replace chapter titles only when the text title lost letters', async () => {
  const { looksGarbled } = await import('../../src/core/structure.js');
  assert.equal(looksGarbled('t two', 'Chapter Two'), true);
  assert.equal(looksGarbled('t e', 'Chapter One'), true);
  assert.equal(looksGarbled('Capítulo 1. La llegada', 'Capítulo 1'), false);
  assert.equal(looksGarbled('The Harbour', 'The Harbour'), false);
  assert.equal(looksGarbled('Salt', 'Part One: Salt and Sea'), true); // fuller bookmark title: harmless
  assert.equal(looksGarbled('The Harbour', 'Salt'), false);
  const blocks = [
    P('t e', { heading: { level: 1, source: 'format' }, page: 3 }), P(long(1), { page: 3 }),
    P('t two', { heading: { level: 1, source: 'format' }, page: 5 }), P(long(2), { page: 5 }),
  ];
  const book = buildBook(blocks, { lang: 'en', outline: [{ title: 'Chapter One', page: 3 }, { title: 'Chapter Two', page: 5 }] });
  assert.deepEqual(book.chapters.map((c) => c.title), ['Chapter One', 'Chapter Two']);
  assert.match(book.warnings.join(' '), /bookmarks/);
});

test('titles drawn with unmapped ligature glyphs are numbered, other text is untouched', () => {
  // "Chapter one" drawn as [Ch][ap]t[er] [on]e: pdf.js gives private-use characters
  const garbled = (rest) => `t ${rest}`;
  const blocks = [P("Author's note", { heading: { level: 1, source: 'format' } }), P(long(0))];
  for (const [k, rest] of ['e', 'two', 'three', 'fo'].entries()) {
    blocks.push(P(garbled(rest), { heading: { level: 1, source: 'format' } }), P(long(k + 1)));
  }
  blocks.push(P('out the author', { heading: { level: 1, source: 'format' } }), P(long(9)));
  const book = buildBook(blocks, { lang: 'en' });
  assert.deepEqual(book.chapters.map((c) => c.title), ['Author’s note', 'Chapter 1', 'Chapter 2', 'Chapter 3', 'Chapter 4', 'out the author']);
  assert.match(book.warnings.join(' '), /4 chapter titles could not be read/);
  assert.match(book.warnings.join(' '), /incomplete .*“out the author”/);
  assert.ok(!JSON.stringify(book).match(/[-]/), 'no private-use characters left');
  // in Spanish books the word is Capítulo
  assert.equal(buildBook(blocks, { lang: 'es' }).chapters[1].title, 'Capítulo 1');
});
