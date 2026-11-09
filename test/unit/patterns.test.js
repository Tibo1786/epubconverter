import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headingKind, isSceneBreak, PAGE_NUMBER_RE } from '../../src/core/patterns.js';

test('chapter headings in four languages', () => {
  for (const t of ['Capítulo 1', 'CAPÍTULO XII', 'Capítulo uno', 'Capítol primer', 'Capítol 3: El far', 'Chapter One', 'CHAPTER 7', 'Chapitre premier', 'Chapitre II — Le retour', 'Prólogo', 'Epíleg', 'Épilogue', 'Prologue', 'Nota de la autora']) {
    assert.equal(headingKind(t), 'chapter', t);
  }
  for (const t of ['Parte I', 'Primera parte', 'Part Two', 'Deuxième partie', 'Llibre primer']) {
    assert.equal(headingKind(t), 'part', t);
  }
  assert.equal(headingKind('12'), 'number');
  assert.equal(headingKind('IV.'), 'number');
});

test('sentences are not headings', () => {
  for (const t of ['Capítulo aparte merece su tía, que nunca sonreía.', 'Chapter and verse, he said.', 'El capítulo 3 empieza mal']) {
    assert.equal(headingKind(t), null, t);
  }
});

test('scene breaks', () => {
  for (const t of ['*', '***', '* * *', '#', '⁂', '~', '• • •', '---']) assert.ok(isSceneBreak(t), t);
  for (const t of ['—', 'A', '*Nota*', '1', '']) assert.ok(!isSceneBreak(t), t);
});

test('page numbers', () => {
  for (const t of ['12', '- 12 -', '– 3 –', 'xii', 'Página 12', 'Page 12 of 300', '12 / 300', 'Pàgina 4']) assert.ok(PAGE_NUMBER_RE.test(t), t);
  for (const t of ['Capítulo 1', '12 de octubre de 1974 fue', 'La casa']) assert.ok(!PAGE_NUMBER_RE.test(t), t);
});
