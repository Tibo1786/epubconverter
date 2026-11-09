import { test } from 'node:test';
import assert from 'node:assert/strict';
import { curlQuotes, fixRunText, normalizeRuns, frenchSpaces, runsText } from '../../src/core/typography.js';

test('straight double quotes become curly, by context', () => {
  assert.equal(curlQuotes('He said "hello" and left.'), 'He said “hello” and left.');
  assert.equal(curlQuotes('"Forecasts Within."'), '“Forecasts Within.”');
  assert.equal(curlQuotes('("quoted")'), '(“quoted”)');
});

test('apostrophes inside words and single quotes', () => {
  assert.equal(curlQuotes("L'Anna s'havia d'imperis"), 'L’Anna s’havia d’imperis');
  assert.equal(curlQuotes("don't 'scare' quotes"), 'don’t ‘scare’ quotes');
  assert.equal(curlQuotes("the '90s"), 'the ‘90s'); // ambiguous; documented behaviour
});

test('typewriter dashes, ligatures, soft hyphens', () => {
  assert.equal(fixRunText('wind -- which', 'en'), 'wind — which');
  assert.equal(fixRunText('ﬁnal ﬂoor', 'en'), 'final floor');
  assert.equal(fixRunText('extra­ordinario', 'es'), 'extraordinario');
});

test('Catalan geminated l is repaired in all its broken forms', () => {
  assert.equal(fixRunText('coŀlecció', 'ca'), 'col·lecció');
  assert.equal(fixRunText('col•lecció col∙lecció col⋅lecció', 'ca'), 'col·lecció col·lecció col·lecció');
  assert.equal(fixRunText('col.lecció', 'ca'), 'col·lecció');
  assert.equal(fixRunText('col.lecció', 'es'), 'col.lecció'); // only in Catalan text
});

test('Spanish punctuation is left untouched', () => {
  const s = '—¿Eres Clara? —preguntó. «Desaparece» ¡Ya!';
  assert.equal(runsText(normalizeRuns([{ t: s }], 'es')), s);
});

test('French spacing uses no-break spaces', () => {
  assert.equal(frenchSpaces('« Bonjour » dit-il : oui ?'), '« Bonjour » dit-il : oui ?');
});

test('runs: whitespace collapsed across boundaries, italics kept, edges trimmed', () => {
  const runs = normalizeRuns([{ t: '  Una inscripción en latín: ' }, { t: ' tempus fugit ', i: true }, { t: '. ' }], 'es');
  assert.deepEqual(runs, [{ t: 'Una inscripción en latín: ' }, { t: 'tempus fugit', i: true }, { t: '.' }]);
});

test('quotes are curled across run boundaries', () => {
  const runs = normalizeRuns([{ t: 'He wrote "' }, { t: 'Forecasts', i: true }, { t: '" on it' }], 'en');
  assert.equal(runsText(runs), 'He wrote “Forecasts” on it');
});

test('dialogue dashes stay glued to their words', async () => {
  const { dashSegments } = await import('../../src/core/typography.js');
  const nw = (s) => dashSegments(s).filter(([, n]) => n).map(([t]) => t);
  assert.deepEqual(nw('—Tu abuelo los coleccionaba —dijo Remei—. Yo me limito'), ['—Tu', '—dijo', 'Remei—.']);
  assert.deepEqual(nw('—¿Eres Clara? —preguntó, sin acercarse.'), ['—¿Eres', '—preguntó,']);
  assert.deepEqual(nw('the wind — which'), []);
  assert.equal(dashSegments('sin rayas').length, 1);
});
