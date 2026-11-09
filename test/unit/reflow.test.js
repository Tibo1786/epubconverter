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
