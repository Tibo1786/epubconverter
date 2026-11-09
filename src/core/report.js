// Quick self-check of a converted book, shown in the UI and the CLI.
import { runsText } from './typography.js';

export function report(book) {
  let paragraphs = 0, scenes = 0, words = 0, notes = 0;
  const suspicious = [];
  for (const c of book.chapters) {
    notes += c.notes?.length ?? 0;
    const ps = c.blocks;
    for (let k = 0; k < ps.length; k++) {
      const b = ps[k];
      if (b.type === 'scene') { scenes++; continue; }
      paragraphs++;
      const t = runsText(b.runs);
      words += t.split(/\s+/).filter(Boolean).length;
      // a paragraph that ends mid-sentence followed by one starting in lower case
      const next = ps[k + 1];
      if (next?.type === 'p' && !/[.!?…:;»”’"')\]—–]$/u.test(t) && /^\p{Ll}/u.test(runsText(next.runs))) {
        suspicious.push(`broken paragraph: "…${t.slice(-40)}" | "${runsText(next.runs).slice(0, 40)}…"`);
      }
      // leftover line-end hyphen joined with a space ("conven- cida")
      for (const m of t.matchAll(/\p{L}{2,}- \p{Ll}{2,}/gu)) suspicious.push(`hyphen + space: "${m[0]}"`);
      if (/\s\d{1,4}\s*$/.test(t) && t.length > 200) suspicious.push(`page number at paragraph end? "…${t.slice(-30)}"`);
    }
  }
  return { chapters: book.chapters.length, paragraphs, scenes, words, notes, suspicious };
}
