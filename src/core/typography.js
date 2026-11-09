// Typographic clean-up applied to every paragraph, whatever the source.
// Conservative by design: it never changes the author's punctuation style
// (« » stays « », dialogue dashes stay), it only repairs typewriter habits
// and extraction artefacts.

const LIGATURES = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' };
const NBSP = ' ';

/**
 * Fixes that are safe on a single run (no cross-run context needed).
 * `faithful` keeps the author's characters: only invisible or glyph-level
 * artefacts (NFC, ligatures, ŀl, soft hyphens, odd spaces) are repaired.
 */
export function fixRunText(s, lang, faithful = false) {
  s = s.normalize('NFC');
  s = s.replace(/[ﬀ-ﬆ]/g, (c) => LIGATURES[c] ?? c);
  // Catalan geminated l: ŀl / Ŀl (precomposed), l.l, l•l, l∙l, l⋅l, l‧l -> l·l
  s = s.replace(/ŀ(?=l)/g, 'l·').replace(/Ŀ(?=L)/g, 'L·');
  s = s.replace(/([lL])[•∙⋅‧･](?=[lL])/g, '$1·');
  if (lang === 'ca' && !faithful) s = s.replace(/(\p{Ll})l\.l(?=\p{Ll})/gu, '$1l·l');
  // Typewriter dashes
  if (!faithful) s = s.replace(/---?/g, '—');
  // Soft hyphens and zero-width characters are layout hints, not text.
  s = s.replace(/[­​‌⁠﻿]/g, '');
  // Private-use characters: glyphs a PDF did not map to any character
  // (display-font ligatures). They cannot be shown, so they are dropped.
  s = s.replace(/[\uE000-\uF8FF]/g, '');
  // Tabs and odd spaces become plain spaces (NBSP is kept: it is intentional).
  s = s.replace(/[\t - 　]/g, ' ');
  return s;
}

/**
 * Straight quotes -> curly quotes using the whole paragraph as context.
 * Operates on a string, returns a string of the same length so that run
 * boundaries can be preserved.
 */
export function curlQuotes(s) {
  const out = s.split('');
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (c !== '"' && c !== "'") continue;
    const prev = i > 0 ? out[i - 1] : '';
    const next = i + 1 < out.length ? out[i + 1] : '';
    const opening = (prev === '' || /[\s(\[{«“‘—–]/u.test(prev)) && next !== '' && !/\s/.test(next);
    if (c === '"') {
      out[i] = opening ? '“' : '”';
    } else if (/[\p{L}\p{N}]/u.test(prev) && /[\p{L}]/u.test(next)) {
      out[i] = '’'; // apostrophe inside a word: l'home, don't
    } else if (opening && next && !/\s/.test(next)) {
      out[i] = '‘';
    } else {
      out[i] = '’';
    }
  }
  return out.join('');
}

/** French spacing: no-break space before : ; ! ? » and after «. */
export function frenchSpaces(s) {
  return s
    .replace(/ +([:;!?»])/g, `${NBSP}$1`)
    .replace(/« +/g, `«${NBSP}`);
}

/**
 * Normalise the runs of one paragraph in place-safe way and return new runs.
 * Runs: {t, i?, b?, sup?} | {note} | {br}
 */
export function normalizeRuns(runs, lang, { faithful = false } = {}) {
  // 1. per-run fixes (every run is copied: raw blocks may be rebuilt later)
  let rs = runs.map((r) => (r.t !== undefined ? { ...r, t: fixRunText(r.t, lang, faithful) } : { ...r }));
  // 2. quotes with paragraph context (length-preserving)
  const textRuns = rs.filter((r) => r.t !== undefined);
  const joined = textRuns.map((r) => r.t).join('');
  if (!faithful && /["']/.test(joined)) {
    const curled = curlQuotes(joined);
    let pos = 0;
    for (const r of textRuns) {
      r.t = curled.slice(pos, pos + r.t.length);
      pos += r.t.length;
    }
  }
  // 3. collapse whitespace across run boundaries, trim paragraph ends
  let prevSpace = true;
  for (const r of rs) {
    if (r.br) { prevSpace = true; continue; }
    if (r.t === undefined) { prevSpace = false; continue; }
    let t = r.t.replace(/ {2,}/g, ' ');
    if (prevSpace) t = t.replace(/^ +/, '');
    if (t.length) prevSpace = t.endsWith(' ') || t.endsWith(NBSP);
    r.t = t;
  }
  // trim trailing
  for (let k = rs.length - 1; k >= 0; k--) {
    const r = rs[k];
    if (r.t === undefined) { if (r.br) { rs.splice(k, 1); continue; } break; }
    r.t = r.t.replace(/[  ]+$/, '');
    if (r.t.length) break;
  }
  // No space before , and . (and ; : ! ? except in French), inside or across runs.
  const punct = lang === 'fr' ? /^(?:,|\.(?!\.))/ : /^(?:[,;:!?]|\.(?!\.))/;
  const inner = lang === 'fr' ? / +(,|\.(?!\.))/g : / +([,;:!?]|\.(?!\.))/g;
  let prevText = null;
  for (const r of faithful ? [] : rs) {
    if (r.t === undefined) { prevText = null; continue; }
    r.t = r.t.replace(inner, '$1');
    if (prevText && punct.test(r.t)) prevText.t = prevText.t.replace(/ +$/, '');
    if (prevText && / $/.test(prevText.t) && /^ /.test(r.t)) r.t = r.t.replace(/^ +/, '');
    prevText = r;
  }
  // a space directly before a note reference is dropped ("palabra ¹" -> "palabra¹")
  for (let k = 1; k < rs.length; k++) {
    if (rs[k].note !== undefined && rs[k - 1].t !== undefined) rs[k - 1].t = rs[k - 1].t.replace(/ +$/, '');
  }
  if (lang === 'fr' && !faithful) {
    const tr = rs.filter((r) => r.t !== undefined);
    const j = tr.map((r) => r.t).join('');
    const f = frenchSpaces(j);
    if (f !== j && f.length === j.length) {
      let pos = 0;
      for (const r of tr) { r.t = f.slice(pos, pos + r.t.length); pos += r.t.length; }
    } else if (f !== j) {
      // length changed (removed double spaces); fall back to per-run
      for (const r of tr) r.t = frenchSpaces(r.t);
    }
  }
  rs = rs.filter((r) => r.t === undefined || r.t.length > 0);
  return mergeRuns(rs);
}

/** Merge adjacent runs with identical formatting. */
export function mergeRuns(runs) {
  const out = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && r.t !== undefined && last.t !== undefined && !!last.i === !!r.i && !!last.b === !!r.b && !!last.sup === !!r.sup) {
      last.t += r.t;
    } else {
      out.push({ ...r });
    }
  }
  // Move whitespace at the edge of an italic/bold run outside it, so the
  // markup reads "a *b* c" not "a* b *c".
  for (let k = 0; k < out.length; k++) {
    const r = out[k];
    if (r.t === undefined || (!r.i && !r.b)) continue;
    const lead = r.t.match(/^ +/);
    const trail = r.t.match(/ +$/);
    if (lead && k > 0 && out[k - 1].t !== undefined && !out[k - 1].i && !out[k - 1].b) {
      out[k - 1].t += lead[0];
      r.t = r.t.slice(lead[0].length);
    }
    if (trail && k + 1 < out.length && out[k + 1].t !== undefined && !out[k + 1].i && !out[k + 1].b) {
      out[k + 1].t = trail[0] + out[k + 1].t;
      r.t = r.t.slice(0, -trail[0].length);
    }
  }
  return out.filter((r) => r.t === undefined || r.t.length > 0);
}

/** Plain text of runs (notes and breaks ignored). */
export function runsText(runs) {
  return runs.map((r) => (r.t !== undefined ? r.t : r.br ? ' ' : '')).join('');
}

/**
 * Split text so that words glued to a dialogue dash ("—¿Eres", "Remei—.",
 * "—dijo") can be rendered unbreakable. Browsers and e-readers otherwise
 * allow a line break between a word and an em dash, which leaves a dash
 * orphaned at the start or end of a line.
 * @returns {Array<[string, boolean]>} [text, nowrap] segments
 */
export function dashSegments(text) {
  if (!text.includes('—')) return [[text, false]];
  const out = [];
  let last = 0;
  const re = /(?<=^|\s)(?:—[^\s—]+|[^\s—]+—[.,;:!?…»”’)]*)(?=\s|$)/gu;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push([text.slice(last, m.index), false]);
    out.push([m[0], true]);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push([text.slice(last), false]);
  return out;
}
