import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLines, reflow } from '../../src/core/pdf/reflow.js';
import { runsText } from '../../src/core/typography.js';

// Helpers to fake pdf.js output: a page of lines of text at known positions.
const FS = 12, PITCH = 16, LEFT = 72, RIGHT = 520, W = 595, H = 842;
const charW = (s) => s.length * FS * 0.5;
function item(str, x, y, opts = {}) {
  return { str, x, y, w: opts.w ?? charW(str), fs: opts.fs ?? FS, bold: !!opts.bold, italic: !!opts.italic };
}
/** lines: [{text, indent?, center?, fs?, italic?, y?}] */
function page(n, lines, { header, footer } = {}) {
  const items = [];
  if (header) items.push(item(header, 250, 40, { fs: 9 }));
  let y = 90;
  for (const l of lines) {
    if (l.gap) { y += l.gap; continue; }
    const fs = l.fs ?? FS;
    const w = charW(l.text) * (fs / FS);
    const x = l.center ? (LEFT + RIGHT) / 2 - w / 2 : LEFT + (l.indent ? 30 : 0);
    // justified lines: stretch to the right margin unless marked short
    const width = l.short || l.center ? w : RIGHT - x;
    items.push({ ...item(l.text, x, l.y ?? y, { fs, italic: l.italic }), w: width });
    y += l.pitch ?? PITCH;
  }
  if (footer) items.push(item(footer, 290, 800, { fs: 9 }));
  return { n, width: W, height: H, items };
}
const texts = (res) => res.blocks.map((b) => (b.type === 'scene' ? '<scene>' : (b.heading ? '#' : '') + runsText(b.runs)));

test('space inference from gaps; tiny standalone space items are ignored', () => {
  const p = { n: 1, width: W, height: H, items: [
    item('me', 72, 100, { w: 12 }), item(' ', 84, 100, { w: 1.3 }), item('canismos', 85.3, 100, { w: 48 }),
    item('y', 140, 100, { w: 6 }), item('luego', 150, 100, { w: 30 }),
  ] };
  assert.equal(buildLines(p)[0].text, 'mecanismos y luego');
});

test('superscript note reference stays on its line', () => {
  const p = { n: 1, width: W, height: H, items: [item('palabra,', 72, 100, { w: 48 }), item('1', 120, 95, { fs: 7, w: 4 }), item('sigue', 128, 100, { w: 30 })] };
  const [l] = buildLines(p);
  assert.equal(l.text, 'palabra,1 sigue');
  assert.ok(l.runs.some((r) => r.sup && r.t === '1'));
});

test('paragraphs by first-line indent, hyphenation joined, headers and page numbers removed', () => {
  const words = ['uno', 'dos', 'tres', 'cuatro', 'cinco'];
  const body = (k) => [
    { text: `Primer párrafo de la hoja ${words[k]} que se extiende hasta el mar-`, indent: true },
    { text: 'gen derecho y continúa en la línea siguiente sin cortes extraños' },
    { text: 'y termina aquí.', short: true },
    { text: 'Segundo párrafo con sangría que también es largo y llega al final', indent: true },
    { text: 'y acaba.', short: true },
  ];
  const pages = [1, 2, 3, 4].map((k) => page(k, [...body(k), ...body(k)], { header: k % 2 ? 'La casa de los relojes' : 'Marta Vidal', footer: String(k) }));
  const res = reflow(pages);
  const t = texts(res);
  assert.equal(t.length, 16);
  assert.equal(t[0], 'Primer párrafo de la hoja dos que se extiende hasta el margen derecho y continúa en la línea siguiente sin cortes extraños y termina aquí.');
  assert.ok(!t.join(' ').includes('Marta Vidal'));
  assert.ok(!t.join(' ').includes('La casa'));
});

test('paragraph continues across a page break when the next page does not indent', () => {
  const p1 = page(1, [
    { text: 'Un párrafo que empieza en una página y sigue sin terminar todavía', indent: true },
    { text: 'porque la frase es muy larga y no cabe en la página de modo que' },
  ]);
  const p2 = page(2, [
    { text: 'continúa aquí arriba y por fin termina en esta línea corta.', short: true },
    { text: 'Otro párrafo distinto empieza aquí y es también bastante largo', indent: true },
    { text: 'para ocupar dos líneas.', short: true },
  ]);
  const t = texts(reflow([p1, p2]));
  assert.equal(t.length, 2);
  assert.match(t[0], /de modo que continúa aquí arriba/);
});

test('block paragraphs separated by vertical space (no indent)', () => {
  const lines = [];
  for (let k = 0; k < 6; k++) {
    lines.push({ text: `Párrafo ${k} en estilo bloque, sin sangría, con una primera línea` });
    lines.push({ text: 'que sigue y termina en esta segunda línea más corta.', short: true });
    lines.push({ gap: PITCH * 0.6 });
  }
  const t = texts(reflow([page(1, lines)]));
  assert.equal(t.length, 6);
  assert.equal(t[2], 'Párrafo 2 en estilo bloque, sin sangría, con una primera línea que sigue y termina en esta segunda línea más corta.');
});

test('headings by size, subtitles, centred scene breaks', () => {
  const lines = [
    { text: 'Capítulo 1', center: true, fs: 20, pitch: 30 },
    { text: 'La llegada', center: true, fs: 14, italic: true, pitch: 30 },
    { text: 'Llegué a Vilanova un martes de noviembre, cuando el tren ya no', indent: true },
    { text: 'traía a nadie.', short: true },
    { text: '***', center: true },
    { text: 'Aquella noche no conseguí dormir y me quedé mirando el techo', indent: true },
    { text: 'hasta el amanecer.', short: true },
    { text: 'Otro párrafo para que haya estadísticas suficientes en la página', indent: true },
    { text: 'y fin.', short: true },
  ];
  const t = texts(reflow([page(1, lines)]));
  assert.deepEqual(t, ['#Capítulo 1', '#La llegada', 'Llegué a Vilanova un martes de noviembre, cuando el tren ya no traía a nadie.', '<scene>',
    'Aquella noche no conseguí dormir y me quedé mirando el techo hasta el amanecer.', 'Otro párrafo para que haya estadísticas suficientes en la página y fin.']);
});

test('footnotes at the bottom of the page are extracted and linked', () => {
  const lines = [];
  for (let k = 0; k < 4; k++) {
    lines.push({ text: `Texto del párrafo ${k} que ocupa toda la línea de la página entera`, indent: true });
    lines.push({ text: 'y termina.', short: true });
  }
  const p = page(1, lines);
  p.items.push(item('nota', 72, 300, { w: 24 }), item('1', 97, 295, { fs: 7, w: 4 }), item('aquí.', 104, 300, { w: 30 }));
  p.items.push(item('1 Esta es la nota al pie.', 72, 760, { fs: 9, w: 120 }));
  const res = reflow([p]);
  const withRef = res.blocks.find((b) => b.runs?.some((r) => r.note));
  assert.ok(withRef, 'note reference resolved');
  const id = withRef.runs.find((r) => r.note).note;
  assert.equal(runsText(res.notes.get(id)), 'Esta es la nota al pie.');
  assert.ok(!texts(res).some((t) => t.includes('Esta es la nota')));
});

test('a full-width body line repeated at the top of several pages is not a running header', () => {
  const pages = [1, 2, 3, 4].map((k) => page(k, [
    { text: 'y la conciencia tranquila de quien no ha hecho nada malo en su vida' },
    { text: 'entera, pensé.', short: true },
    { text: `Un párrafo distinto en la hoja ${['a', 'b', 'c', 'd'][k - 1]} que llega al margen derecho`, indent: true },
    { text: 'y termina.', short: true },
  ], { header: 'Marta Vidal' }));
  const t = texts(reflow(pages));
  assert.equal(t.filter((x) => x.includes('y la conciencia tranquila')).length, 4);
  assert.ok(!t.join(' ').includes('Marta Vidal'));
});

test('text drawn on top of the same text (flattening, shadows) is dropped', async () => {
  const { dropOverlaps } = await import('../../src/core/pdf/reflow.js');
  const line = item('Margot and I were preparing to host our monthly dinner', 147, 400, { w: 354 });
  const dup1 = item('monthly din', 280, 400, { w: 60 });
  const dup2 = item('onthly din', 284, 400, { w: 56 });
  const other = item('next line', 147, 422, { w: 50 });
  const kept = dropOverlaps([line, dup1, dup2, other]);
  assert.deepEqual(kept.map((k) => k.str).sort(), ['Margot and I were preparing to host our monthly dinner', 'next line'].sort());
  const p = { n: 1, width: W, height: H, items: [line, dup1, dup2] };
  assert.equal(buildLines(p)[0].text, 'Margot and I were preparing to host our monthly dinner');
});

test('a drop cap is glued to the first of the lines beside it and does not merge lines', () => {
  const capFs = 66;
  const items = [
    item('M', 95, 145, { fs: capFs, w: 45 }),
    item('argot and I were preparing to host our monthly dinner', 142, 100, { w: 360 }),
    item('party when I told her this was not working for me any', 142, 122, { w: 360 }),
    item('more. I had decided it earlier that evening while we', 142, 145, { w: 360 }),
    item('were shopping at the market in our neighbourhood, and', 95, 167, { w: 407 }),
  ];
  const lines = buildLines({ n: 1, width: W, height: H, items });
  assert.equal(lines.length, 4);
  assert.equal(lines[0].text, 'Margot and I were preparing to host our monthly dinner');
  assert.equal(lines[2].text, 'more. I had decided it earlier that evening while we');
  assert.ok(lines[1].besideCap && lines[2].besideCap, 'lines beside the cap are not indented paragraphs');
});

test('a one-letter drop cap that is a word gets its space ("I was")', () => {
  const page = (n, extra) => ({ n, width: W, height: H, items: [
    item('I', 72, 145, { fs: 66, w: 18 }),
    item('was born in a small town by the sea where nothing ever', 96, 100, { w: 420 }),
    item('happened, or so everybody said, until the winter when', 96, 122, { w: 420 }),
    item('the lighthouse went dark for one whole night and day.', 96, 145, { w: 420 }),
    ...extra,
  ] });
  const res = reflow([page(1, [])]);
  assert.match(runsText(res.blocks[0].runs), /^I was born in a small town/);
});

test('indented blocks: a smaller letter and a hanging-indent list keep their lines together', () => {
  const lines = [];
  for (let k = 0; k < 3; k++) {
    lines.push({ text: `Body paragraph ${k} that runs on for the whole width of the page`, indent: true });
    lines.push({ text: 'and ends here.', short: true });
  }
  const p = page(1, lines);
  // a list with a hanging indent, ragged right
  let y = 300;
  for (const [first, cont] of [['1. The sound of the foghorn at four in the morning,', 'which she hated.'], ['2. The view from the gallery at dusk, when the', 'mainland looked like a rumour.']]) {
    p.items.push({ ...item(first, 102, y), w: 300 });
    p.items.push({ ...item(cont, 116, y + PITCH), w: 200 });
    y += 2 * PITCH;
  }
  // a quoted letter: smaller, indented both sides, ragged
  for (const t of ['Dear Mr Morrow, we regret to inform you that', 'the light is to be automated this year.', 'Yours faithfully, the Commissioners.']) {
    p.items.push({ ...item(t, 108, y, { fs: 10 }), w: 280 });
    y += 14;
  }
  const t = texts(reflow([p]));
  assert.ok(t.includes('1. The sound of the foghorn at four in the morning, which she hated.'), t.join('\n'));
  assert.ok(t.includes('2. The view from the gallery at dusk, when the mainland looked like a rumour.'));
  assert.ok(t.includes('Dear Mr Morrow, we regret to inform you that the light is to be automated this year.'));
  assert.ok(t.includes('Yours faithfully, the Commissioners.'));
});

test('dialogue pages: the margin is the leftmost common start, not the most frequent one', () => {
  const lines = [];
  for (const t of ['“Are you coming?” she asked, already halfway out of the door', '“Not yet,” I said.', '“Then when?” Her voice had an edge to it now that I had not', '“Soon.”', '“That is what you always say.”', '“Because it is always true.”', '“It never is.” She left, and the door swung shut behind her']) {
    const long = t.length > 40;
    lines.push({ text: t, indent: true, short: !long });
    if (long) lines.push({ text: 'heard before.', short: true });
  }
  const t = texts(reflow([page(1, lines)]));
  assert.equal(t.length, 7, t.join('\n'));
});
