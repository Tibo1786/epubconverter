// Chapter titles by "look": rules the user can pick when automatic detection
// gets it wrong, and the automatic fallback used when no chapter is found.
//
// A rule is {kind, value?}:
//   style  - a Word paragraph style (value = style name)
//   size   - text of a given size larger than the body (value = points)
//   bold   - whole line in bold
//   caps   - whole line in capitals
//   center - centred line
//   number - line starting with a number ("1", "1. Title", "IV")

import { runsText } from './typography.js';
import { isSceneBreak } from './patterns.js';

const NUMBER_START = /^(?:\d{1,3}|[IVXLCDM]{1,7})(?=[.):—–-]|\s|$)/u;
const NOT_A_HEADING_STYLE = /normal|body|standard|default|texto|text|cuerpo|corps|cos|first paragraph|quote|cita|epigra|ep[ií]graf|dedica|verse|verso|poem|po[eè]m|firma|signature|address|list|lista|caption|footnote|header|footer|title|t[ií]tulo|t[ií]tol|titre|subtitle|toc/i;

const textOf = (b) => runsText(b.runs).trim();

/** A short, standalone line: the only kind of paragraph that can be a title. */
function isShortLine(b) {
  if (b.type !== 'p' || b.isolated === false) return false;
  const t = textOf(b);
  return t.length > 0 && t.length <= 100 && !isSceneBreak(t) && /\p{L}|\d/u.test(t);
}

function bodySize(blocks) {
  const chars = new Map();
  for (const b of blocks) {
    if (b.type !== 'p' || !b.size) continue;
    const n = textOf(b).length;
    const k = Math.round(b.size * 2) / 2;
    chars.set(k, (chars.get(k) ?? 0) + n);
  }
  let best = null, bestN = -1;
  for (const [k, n] of chars) if (n > bestN) { best = k; bestN = n; }
  return best;
}

function isCaps(t) {
  const letters = t.replace(/[^\p{L}]/gu, '');
  return letters.length >= 3 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
}

export function matchesRule(b, rule, ctx = {}) {
  if (!isShortLine(b)) return false;
  const t = textOf(b);
  switch (rule.kind) {
    case 'style': return b.styleName === rule.value;
    case 'size': return !!b.size && Math.abs(Math.round(b.size * 2) / 2 - rule.value) < 0.3;
    case 'bold': return !!b.allBold && !/[.,;]$/.test(t);
    case 'caps': return isCaps(t);
    case 'center': return b.align === 'center';
    case 'number': return NUMBER_START.test(t) && t.length <= 70 && (ctx.strict ? !/[.!?…]$/.test(t.replace(/^\S+\s*/, '')) || t.length < 6 : true);
    default: return false;
  }
}

const LABELS = {
  style: (v) => `Paragraph style “${v}”`,
  size: (v) => `Larger text (${v} pt)`,
  bold: () => 'Bold lines',
  caps: () => 'Lines in CAPITALS',
  center: () => 'Centred lines',
  number: () => 'Lines starting with a number',
};

/**
 * The chapter-title rules this document could plausibly use, with how many
 * lines each would turn into chapters and an example.
 */
export function headingOptions(blocks) {
  const ps = blocks.filter((b) => b.type === 'p');
  const max = Math.max(3, Math.round(ps.length * 0.4));
  const body = bodySize(blocks);
  const candidates = [];
  // Word paragraph styles used only on short lines
  const styles = new Map();
  for (const b of ps) {
    if (!b.styleName) continue;
    const s = styles.get(b.styleName) ?? { total: 0, short: 0 };
    s.total++;
    if (isShortLine(b)) s.short++;
    styles.set(b.styleName, s);
  }
  for (const [name, s] of styles) {
    if (!NOT_A_HEADING_STYLE.test(name) && s.short / s.total >= 0.9) candidates.push({ kind: 'style', value: name });
  }
  // sizes larger than the body text
  if (body) {
    const sizes = new Set(ps.filter((b) => isShortLine(b) && b.size && b.size >= body + 1).map((b) => Math.round(b.size * 2) / 2));
    for (const v of [...sizes].sort((a, b) => b - a)) candidates.push({ kind: 'size', value: v });
  }
  for (const kind of ['bold', 'caps', 'number', 'center']) candidates.push({ kind });

  const out = [];
  for (const rule of candidates) {
    const hits = ps.filter((b) => matchesRule(b, rule));
    if (hits.length < 2 || hits.length > max) continue;
    out.push({ ...rule, id: rule.value !== undefined ? `${rule.kind}:${rule.value}` : rule.kind, label: LABELS[rule.kind](rule.value), count: hits.length, example: textOf(hits[1] ?? hits[0]).slice(0, 60) });
  }
  return out;
}

/**
 * When no chapter title was found at all, pick the most consistent rule:
 * every match must be followed by real text (a title, not a stray bold line).
 */
export function fallbackRule(blocks) {
  const order = ['style', 'size', 'bold', 'caps', 'number', 'center'];
  const options = headingOptions(blocks).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  for (const rule of options) {
    if (rule.count < 3) continue;
    let followed = 0, total = 0;
    blocks.forEach((b, i) => {
      if (!matchesRule(b, rule, { strict: true })) return;
      total++;
      const next = blocks.slice(i + 1, i + 4).find((n) => n.type === 'p' && textOf(n).length > 120);
      if (next) followed++;
    });
    if (total >= 3 && followed / total >= 0.8) return { kind: rule.kind, value: rule.value, id: rule.id, label: rule.label };
  }
  return null;
}
