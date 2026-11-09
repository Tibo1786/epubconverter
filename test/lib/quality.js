// Quality measurement: compare a converted book with a fixture's ground truth.
import { runsText } from '../../src/core/typography.js';

/** Runs -> text with *italic* / **bold** markers (matching the fixture markup). */
export function runsMarkup(runs) {
  let s = '';
  for (const r of runs) {
    if (r.t === undefined) continue;
    if (r.b && r.i) s += `***${r.t}***`;
    else if (r.b) s += `**${r.t}**`;
    else if (r.i) s += `*${r.t}*`;
    else s += r.t;
  }
  return s;
}

/** Whitespace-insensitive key (NBSP vs space does not matter here). */
export const ws = (s) => s.replace(/[\s  ]+/g, ' ').trim();
export const plain = (s) => ws(s.replace(/\*+/g, ''));

export function blocksOf(chapter, { markup = true } = {}) {
  return chapter.blocks.map((b) => (b.type === 'scene' ? '<scene>' : ws(markup ? runsMarkup(b.runs) : runsText(b.runs))));
}

/**
 * @returns {{paragraphs:{total, exact, plainExact, rate, plainRate}, chapters:{expected, got, ok}, misses: string[], forbidden: string[]}}
 */
export function measure(book, expected, { markup = true } = {}) {
  const gotTitles = book.chapters.map((c) => ws(c.title));
  const expTitles = expected.chapters.map((c) => ws(c.title));
  const got = book.chapters.flatMap((c) => blocksOf(c, { markup }));
  const exp = expected.chapters.flatMap((c) => c.blocks.map((b) => (b === '<scene>' ? b : ws(markup ? b : plain(b)))));
  const gotSet = new Map();
  for (const g of got) gotSet.set(g, (gotSet.get(g) ?? 0) + 1);
  const gotPlain = new Set(got.map(plain));
  let exact = 0, plainExact = 0;
  const misses = [];
  for (const e of exp) {
    if (gotSet.get(e) > 0) { exact++; gotSet.set(e, gotSet.get(e) - 1); plainExact++; }
    else {
      if (gotPlain.has(plain(e))) plainExact++;
      misses.push(e);
    }
  }
  const body = got.join('\n');
  const forbidden = (expected.forbidden || []).filter((f) => body.includes(f));
  return {
    paragraphs: { total: exp.length, got: got.length, exact, plainExact, rate: exact / exp.length, plainRate: plainExact / exp.length },
    chapters: { expected: expTitles, got: gotTitles, ok: JSON.stringify(expTitles) === JSON.stringify(gotTitles) },
    extra: got.filter((g) => !exp.includes(g)),
    misses,
    forbidden,
  };
}
