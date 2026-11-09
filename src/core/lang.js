// Tiny stopword-based language identification for es / ca / en / fr.
// Deterministic, dependency-free, good enough on a paragraph (>~100 chars).

export const LISTS = {
  es: 'el los las con por es pero muy esta este hasta también su sus fue era y del al lo le se que en un una no como más cuando donde porque ya sin sobre entre había estaba dijo pues aunque mientras hacia nada todo eso esto mi tu ella él usted',
  ca: 'els les amb per és però molt aquesta aquest fins també seva seu seus va i del al ho hi es que en un una no com més quan on perquè ja sense sobre entre havia estava dir doncs mentre cap res tot això allò meu teu ella ell vostè dels pels uns unes',
  en: 'the and of to in is was that it he she with for as his her on at by had not but they you from have this be are were which there their an or would what so if out about who them been when one all said could into than then',
  fr: 'le la les et est des une dans pour pas qui que il elle au aux ce ne sur avec mais du se en un sont était avait comme plus tout cette son ses leur lui nous vous où quand je on y bien fait dit',
};

const SETS = Object.fromEntries(Object.entries(LISTS).map(([k, v]) => [k, new Set(v.split(' '))]));
// Words that are strong signals on their own (weighted extra).
const STRONG = {
  es: ['los', 'las', 'con', 'pero', 'muy', 'esta', 'y', 'había', 'estaba', 'dijo', 'él', 'usted', 'fue'],
  ca: ['els', 'amb', 'però', 'molt', 'aquesta', 'i', 'havia', 'estava', 'perquè', 'això', 'dels', 'pels', 'ho', 'hi', 'va'],
  en: ['the', 'and', 'of', 'was', 'with', 'had', 'were', 'which', 'would'],
  fr: ['et', 'des', 'dans', 'pour', 'pas', 'qui', 'était', 'avait', 'cette', 'nous', 'vous', 'où'],
};
const STRONG_SETS = Object.fromEntries(Object.entries(STRONG).map(([k, v]) => [k, new Set(v)]));

export const LANGS = ['es', 'ca', 'en', 'fr'];

export function scoreLanguages(text) {
  const words = text.toLowerCase().normalize('NFC').split(/[^\p{L}·']+/u).filter(Boolean);
  const scores = { es: 0, ca: 0, en: 0, fr: 0 };
  for (let w of words) {
    // l'home, d'una, s'havia -> split elision
    const el = w.match(/^([ldsnmtj])'(.+)$/);
    if (el) {
      if ('ldsnmt'.includes(el[1])) { scores.ca += 0.5; scores.fr += 0.5; }
      w = el[2];
    }
    for (const l of LANGS) {
      if (SETS[l].has(w)) scores[l] += STRONG_SETS[l].has(w) ? 2 : 1;
    }
    if (w.includes('·')) scores.ca += 3;
    if (/ñ/.test(w)) scores.es += 2;
    if (/[àèò]/.test(w)) { scores.ca += 1; scores.fr += 0.5; }
    if (/[êâîôûëïç]/.test(w) && !/ç/.test(w)) scores.fr += 1;
  }
  if (/[¿¡]/.test(text)) scores.es += 3;
  return { scores, words: words.length };
}

/** Returns {lang, confidence} where confidence is the margin over runner-up (0..1). */
export function detectLanguage(text) {
  const { scores, words } = scoreLanguages(text);
  const ranked = LANGS.map((l) => [l, scores[l]]).sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  if (!words || best[1] === 0) return { lang: null, confidence: 0 };
  const confidence = (best[1] - second[1]) / best[1];
  return { lang: best[0], confidence, density: best[1] / words };
}
