// Text patterns shared by all readers (Spanish, Catalan, English, French).

const NUM_WORDS = [
  // es
  'uno', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece',
  'catorce', 'quince', 'veinte', 'primero', 'primera', 'segundo', 'segunda', 'tercero', 'tercera', 'cuarto', 'cuarta',
  'quinto', 'quinta', 'sexto', 'séptimo', 'octavo', 'noveno', 'décimo', 'último', 'última',
  // ca
  'un', 'u', 'dues', 'quatre', 'cinc', 'sis', 'set', 'vuit', 'nou', 'deu', 'onze', 'dotze', 'tretze', 'catorze',
  'quinze', 'vint', 'primer', 'primera', 'segon', 'segona', 'tercer', 'tercera', 'quart', 'quarta', 'cinquè', 'sisè',
  'setè', 'vuitè', 'novè', 'desè', 'darrer', 'darrera', 'últim', 'última',
  // en
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'twenty', 'first', 'second', 'third', 'fourth', 'fifth', 'last', 'final',
  // fr
  'deux', 'trois', 'quatre', 'cinq', 'sept', 'huit', 'neuf', 'dix', 'premier', 'première', 'deuxième',
  'troisième', 'quatrième', 'cinquième', 'dernier', 'dernière',
];

const CHAPTER_WORDS = [
  'cap[ií]tulo', 'cap[ií]tol', 'chapter', 'chapitre', 'kapitel', 'cap\\.',
];
const PART_WORDS = ['parte', 'part', 'partie', 'libro', 'llibre', 'book', 'livre', 'volumen', 'volum', 'volume'];
const STANDALONE = [
  'pr[oó]logo', 'pr[oò]leg', 'prologue', 'ep[ií]logo', 'ep[ií]leg', '[ée]pilogue', 'epilogue',
  'interludio', 'interludi', 'interlude', 'introducci[oó]n?', 'introduction', 'pr[ée]face', 'prefacio', 'pref[aà]ci',
  'pr[ée]ambule', 'pre[aá]mbulo', 'pre[aà]mbul', 'coda', 'postfacio', 'postface', 'postfaci',
  'agradecimientos', 'agra[iï]ments', 'acknowledg(e)?ments', 'remerciements',
  'nota del autor', 'nota de l[\'’]autor', 'nota de la autora', 'nota de l[\'’]autora', "author[\'’]s note", 'note de l[\'’]auteur',
];

const ROMAN = '[IVXLCDM]{1,7}';
const NUMBER = `(?:\\d{1,3}|${ROMAN}|${NUM_WORDS.join('|')})`;

// "Capítulo 1", "CAPÍTULO XII", "Chapter One", "Capítol primer: El far", "Chapitre 3 — Le retour"
export const CHAPTER_RE = new RegExp(
  `^(?:${CHAPTER_WORDS.join('|')})\\s+${NUMBER}\\b\\s*(?:[.:—–-]\\s*\\S.*)?$`, 'iu');
export const PART_RE = new RegExp(
  `^(?:${PART_WORDS.join('|')})\\s+${NUMBER}\\b\\s*(?:[.:—–-]\\s*\\S.*)?$|^(?:primera|segunda|tercera|cuarta|première|deuxième|troisième|first|second|third|fourth|primera|segona|tercera|quarta)\\s+(?:parte|part|partie)\\b.*$`, 'iu');
export const STANDALONE_RE = new RegExp(`^(?:${STANDALONE.join('|')})\\s*(?:[.:—–-]\\s*\\S.*)?$`, 'iu');
// A line that is only a number: "1", "IV", "12."
export const BARE_NUMBER_RE = new RegExp(`^(?:\\d{1,3}|${ROMAN})\\.?$`, 'u');

/** Classify a short line as a chapter-ish heading by its wording alone. */
export function headingKind(text) {
  const t = text.trim();
  if (t.length > 90) return null;
  if (PART_RE.test(t)) return 'part';
  if (CHAPTER_RE.test(t)) return 'chapter';
  if (STANDALONE_RE.test(t)) return 'chapter';
  if (BARE_NUMBER_RE.test(t)) return 'number';
  return null;
}

// Scene breaks: lines made only of break symbols: *, ***, * * *, #, ⁂, ~, •, ·, ◊, ❦, ---
export const SCENE_RE = /^[\s ]*(?:[*#~•·◊❦⁂§+=_–—-][\s ]*){1,12}$/u;
export function isSceneBreak(text) {
  const t = text.trim();
  if (!t || t.length > 24) return false;
  if (!SCENE_RE.test(t)) return false;
  // A lone dash or underscore line is unlikely to be a scene break in prose.
  if (/^[–—_-]$/.test(t)) return false;
  return true;
}

// Running page numbers: "12", "- 12 -", "– 12 –", "xii", "Página 12", "Page 12 of 300", "12 / 300"
export const PAGE_NUMBER_RE = /^[\s\-–—|·•]*(?:(?:p[aá]g(?:ina)?\.?|page|p\.|p[àa]gina)\s*)?(?:\d{1,4}|[ivxlcdm]{1,8})(?:\s*(?:\/|de|of|sur|di)\s*\d{1,4})?[\s\-–—|·•]*$/i;

export const TERMINAL_RE = /[.!?…:;»”’"')\]—–]$/u;
export const SENTENCE_END_RE = /[.!?…»”’"')\]]$/u;
