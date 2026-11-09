// Plain-text reader: decoding, hard-wrap unwrapping, _italics_, headings.

import { joinHyphenated, endsWithHyphenation, WordStats } from './dehyphen.js';
import { headingKind, isSceneBreak } from './patterns.js';

export function decodeText(bytes) {
  let s;
  try {
    s = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    s = new TextDecoder('windows-1252').decode(bytes);
  }
  return s.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

/** _italic_ and *italic* markers -> runs */
export function markupRuns(text) {
  const runs = [];
  const re = /(^|[\s(«"“'‘—¿¡])([_*])(?=\S)([^\n]*?\S)\2(?=$|[\s.,;:!?)»"”'’—…])/gu;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    const start = m.index + m[1].length;
    if (start > last) runs.push({ t: text.slice(last, start) });
    runs.push({ t: m[3], i: true });
    last = start + m[2].length * 2 + m[3].length;
    re.lastIndex = last;
  }
  if (last < text.length) runs.push({ t: text.slice(last) });
  return runs;
}

/**
 * @param {Uint8Array|string} input
 */
export function readText(input) {
  const text = typeof input === 'string' ? input : decodeText(input);
  const rawLines = text.split('\n').map((l) => l.replace(/\s+$/, ''));
  const stats = new WordStats();
  stats.addText(text);

  // Paragraph groups: separated by blank lines.
  const groups = [];
  let cur = [];
  let blanksBefore = 0;
  for (const l of rawLines) {
    if (l.trim() === '') {
      if (cur.length) { groups.push({ lines: cur, blanksBefore }); cur = []; blanksBefore = 0; }
      blanksBefore++;
      continue;
    }
    cur.push(l);
  }
  if (cur.length) groups.push({ lines: cur, blanksBefore });

  // If there are almost no blank lines, each line is a paragraph unless lines
  // look hard-wrapped (similar lengths close to a column limit).
  const lens = rawLines.filter((l) => l.trim()).map((l) => l.length).sort((a, b) => a - b);
  const p90 = lens[Math.floor(lens.length * 0.9)] ?? 0;
  const hardWrapped = p90 > 0 && p90 <= 100;
  const blankLines = rawLines.filter((l) => !l.trim()).length;
  const linePerPara = blankLines < rawLines.length * 0.05 && !hardWrapped;
  let effective = groups;
  if (linePerPara) effective = groups.flatMap((g) => g.lines.map((l, i) => ({ lines: [l], blanksBefore: i ? 0 : g.blanksBefore })));
  // Paragraphs indented in a hard-wrapped block without blank lines
  if (hardWrapped && groups.some((g) => g.lines.length > 30)) {
    effective = [];
    for (const g of groups) {
      let c = [];
      g.lines.forEach((l, i) => {
        if (i && /^\s{2,}\S/.test(l) && !/^\s{2,}\S/.test(g.lines[i - 1] ?? '')) { effective.push({ lines: c, blanksBefore: 0 }); c = []; }
        c.push(l);
      });
      if (c.length) effective.push({ lines: c, blanksBefore: g.blanksBefore });
    }
  }

  // Groups of short lines (title page, addresses) are separate lines, not a
  // wrapped paragraph.
  effective = effective.flatMap((g) =>
    g.lines.length > 1 && hardWrapped && g.lines.every((l) => l.trim().length < p90 * 0.6)
      ? g.lines.map((l, i) => ({ lines: [l], blanksBefore: i ? 0 : g.blanksBefore }))
      : [g]);

  const blocks = [];
  for (const g of effective) {
    const lines = g.lines.map((l) => l.trim());
    if (lines.length === 1 && isSceneBreak(lines[0])) { blocks.push({ type: 'scene' }); continue; }
    let para = lines[0];
    for (let i = 1; i < lines.length; i++) {
      if (endsWithHyphenation(para) && /^\p{Ll}/u.test(lines[i])) {
        para = joinHyphenated(para, lines[i], { stats }).text;
      } else if (/\p{L}—$/u.test(para) && /^\p{L}/u.test(lines[i])) {
        para += lines[i];
      } else {
        para += ' ' + lines[i];
      }
    }
    const block = { type: 'p', runs: markupRuns(para), align: 'left' };
    if (lines.length === 1) {
      const t = lines[0];
      const kind = headingKind(t);
      const letters = t.replace(/[^\p{L}]/gu, '');
      const caps = letters.length >= 3 && letters === letters.toUpperCase() && t.length <= 60 && !/[.!?,;]$/.test(t);
      if (kind === 'chapter' || kind === 'part') block.heading = { level: 1, source: 'pattern' };
      else if (kind === 'number' && g.blanksBefore >= 2) block.heading = { level: 1, source: 'pattern' };
      else if (caps && g.blanksBefore >= 2) block.heading = { level: 1, source: 'format' };
      block.isolated = 'strong';
    }
    blocks.push(block);
  }
  return { blocks, notes: new Map(), meta: {}, warnings: [], source: 'txt' };
}
