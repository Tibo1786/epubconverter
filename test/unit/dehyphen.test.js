import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinHyphenated, endsWithHyphenation, WordStats } from '../../src/core/dehyphen.js';

const stats = (t) => { const s = new WordStats(); s.addText(t); return s; };

test('plain line-break hyphenation is joined', () => {
  assert.deepEqual(joinHyphenated('pero no: conven-', 'cida de que', {}), { join: true, text: 'pero no: convencida de que' });
});

test('soft hyphen at line end always joins', () => {
  assert.equal(joinHyphenated('extraordinaria­', 'mente concreta').text, 'extraordinariamente concreta');
});

test('Catalan l·l split as "l-" / "l" is restored', () => {
  assert.equal(joinHyphenated('una caixa metàl-', 'lica, petita', { lang: 'ca' }).text, 'una caixa metàl·lica, petita');
  // in another language only with evidence from the document
  assert.equal(joinHyphenated('the col-', 'lecció was', { lang: 'en', stats: stats('una col·lecció') }).text, 'the col·lecció was');
});

test('real compounds keep their hyphen when the document shows them', () => {
  const s = stats('el mundo franco-suizo de la relojería');
  assert.equal(joinHyphenated('en el mundo franco-', 'suizo de', { stats: s }).text, 'en el mundo franco-suizo de');
});

test('document evidence for the joined form wins', () => {
  const s = stats('well-known but also wellknown wellknown');
  assert.equal(joinHyphenated('a well-', 'known fact', { stats: s }).text, 'a wellknown fact');
});

test('upper-case continuation keeps the hyphen', () => {
  assert.equal(joinHyphenated('the anti-', 'Franco movement').text, 'the anti-Franco movement');
});

test('endsWithHyphenation ignores dashes that are not word breaks', () => {
  assert.equal(endsWithHyphenation('conven-'), true);
  assert.equal(endsWithHyphenation('dijo -'), false);
  assert.equal(endsWithHyphenation('1974-'), false);
});
