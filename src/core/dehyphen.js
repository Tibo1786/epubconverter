// Joining words hyphenated across line breaks.
//
// Decision for "left-" + "right":
//  * soft hyphen (U+00AD) at the break: always join;
//  * Catalan "l-" + "l…" comes from l·l (col·lecció -> col- / lecció): restore "l·l";
//  * evidence from the document itself: if "left-right" appears elsewhere
//    inside a line, it is a real compound and the hyphen stays; if
//    "leftright" appears elsewhere, join;
//  * otherwise join, unless the right part starts with an upper-case letter
//    or a digit (anti-Franco, COVID-19).

const WORD_RE = /[\p{L}\p{M}·'’-]+/gu;

/** Count word forms in a text, for evidence-based dehyphenation. */
export class WordStats {
  constructor() {
    this.words = new Map();
  }
  addText(text) {
    for (const m of text.matchAll(WORD_RE)) {
      const w = m[0].toLowerCase().replace(/^[-'’]+|[-'’]+$/g, '');
      if (w) this.words.set(w, (this.words.get(w) ?? 0) + 1);
    }
  }
  has(w) {
    return (this.words.get(w.toLowerCase()) ?? 0) > 0;
  }
}

const HYPHENS = /[-‐­]$/;

/** Does this line end with a hyphenated word fragment? */
export function endsWithHyphenation(line) {
  return /\p{L}[-‐­]$/u.test(line) && !/(^|\s)[-‐]$/.test(line);
}

/**
 * @param {string} leftLine  text of the line ending with the hyphen
 * @param {string} rightLine text of the next line
 * @param {{lang?: string, stats?: WordStats}} ctx
 * @returns {{join: boolean, text: string}} how to glue the two lines
 */
export function joinHyphenated(leftLine, rightLine, ctx = {}) {
  const hy = leftLine.slice(-1);
  const body = leftLine.slice(0, -1);
  const leftWord = (body.match(/[\p{L}\p{M}·'’]+$/u) || [''])[0];
  const rightWord = (rightLine.match(/^[\p{L}\p{M}·'’]+/u) || [''])[0];
  if (!leftWord || !rightWord) return { join: false, text: `${leftLine}${rightLine.startsWith(' ') ? '' : ''}${rightLine}` };
  if (hy === '­') return { join: true, text: body + rightLine };

  const stats = ctx.stats;
  const lowerRight = rightWord.toLowerCase();
  const lowerLeft = leftWord.toLowerCase();

  // Catalan l·l
  if (/l$/i.test(leftWord) && /^l/i.test(rightWord)) {
    const ll = `${lowerLeft}·${lowerRight}`;
    if (ctx.lang === 'ca' || (stats && stats.has(ll))) {
      return { join: true, text: `${body}·${rightLine}` };
    }
  }
  if (stats) {
    const compound = `${lowerLeft}-${lowerRight}`;
    const joined = lowerLeft + lowerRight;
    const hasCompound = stats.has(compound);
    const hasJoined = stats.has(joined);
    if (hasCompound && !hasJoined) return { join: false, text: `${body}-${rightLine}` };
    if (hasJoined) return { join: true, text: body + rightLine };
  }
  if (/^[\p{Lu}\p{N}]/u.test(rightWord)) return { join: false, text: `${body}-${rightLine}` };
  return { join: true, text: body + rightLine };
}

export { HYPHENS };
