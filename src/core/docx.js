// DOCX reader: unzip + OOXML -> raw blocks for structure.js.
//
// What it handles, because manuscripts do all of this:
//  * style inheritance: docDefaults -> paragraph style chain -> character
//    style chain -> direct formatting (italic/bold inherited from styles);
//  * headings by style (Heading 1..9 / outline level) and "fake" headings
//    typed as big, bold or centred text in the Normal style;
//  * tracked changes: insertions kept, deletions dropped, moves resolved;
//  * fields: the displayed result is kept, the field code is dropped;
//  * footnotes and endnotes -> note references;
//  * soft hyphens dropped, no-break hyphens kept, tabs -> spaces,
//    hidden text (w:vanish) dropped, page breaks recorded;
//  * w:lang hints and core.xml title/author.

import { unzipSync, strFromU8 } from '../../vendor/fflate/fflate.mjs';
import { parseXml } from './xml.js';

const HEADING_NAME_RE = /^(?:heading|título|titulo|títol|titol|titre|überschrift|kop)\s*(\d)$/i;

function onOff(el) {
  if (!el) return undefined;
  const v = el.attr('w:val');
  return !(v === '0' || v === 'false' || v === 'off' || v === 'none');
}

function readRPr(rPr) {
  if (!rPr) return {};
  const o = {};
  const b = onOff(rPr.child('w:b'));
  if (b !== undefined) o.b = b;
  const i = onOff(rPr.child('w:i'));
  if (i !== undefined) o.i = i;
  const v = onOff(rPr.child('w:vanish'));
  if (v !== undefined) o.vanish = v;
  const caps = onOff(rPr.child('w:caps'));
  if (caps !== undefined) o.caps = caps;
  const sz = rPr.child('w:sz');
  if (sz) o.sz = parseInt(sz.attr('w:val'), 10) / 2;
  const va = rPr.child('w:vertAlign');
  if (va) o.sup = va.attr('w:val') === 'superscript';
  const lang = rPr.child('w:lang');
  if (lang && lang.attr('w:val')) o.lang = lang.attr('w:val');
  const rs = rPr.child('w:rStyle');
  if (rs) o.rStyle = rs.attr('w:val');
  return o;
}

function readPPr(pPr) {
  if (!pPr) return {};
  const o = {};
  const jc = pPr.child('w:jc');
  if (jc) o.jc = jc.attr('w:val');
  const ol = pPr.child('w:outlineLvl');
  if (ol) o.outline = parseInt(ol.attr('w:val'), 10);
  const pb = onOff(pPr.child('w:pageBreakBefore'));
  if (pb !== undefined) o.pageBreakBefore = pb;
  const ps = pPr.child('w:pStyle');
  if (ps) o.pStyle = ps.attr('w:val');
  const ind = pPr.child('w:ind');
  if (ind) {
    const fl = ind.attr('w:firstLine');
    if (fl !== undefined) o.firstLine = parseInt(fl, 10);
  }
  const rPr = pPr.child('w:rPr'); // paragraph mark formatting: ignored for text
  void rPr;
  return o;
}

class Styles {
  constructor(xml) {
    this.byId = new Map();
    this.defaults = { r: {}, p: {} };
    this.defaultParagraph = null;
    if (!xml) return;
    const root = parseXml(xml);
    const styles = root.child('w:styles');
    if (!styles) return;
    const dd = styles.child('w:docDefaults');
    if (dd) {
      const rd = dd.child('w:rPrDefault');
      if (rd) this.defaults.r = readRPr(rd.child('w:rPr'));
      const pd = dd.child('w:pPrDefault');
      if (pd) this.defaults.p = readPPr(pd.child('w:pPr'));
    }
    for (const s of styles.childrenNamed('w:style')) {
      const id = s.attr('w:styleId');
      const name = s.child('w:name')?.attr('w:val') ?? id;
      const basedOn = s.child('w:basedOn')?.attr('w:val');
      const st = {
        id, name, type: s.attr('w:type'), basedOn,
        p: readPPr(s.child('w:pPr')),
        r: readRPr(s.child('w:rPr')),
      };
      this.byId.set(id, st);
      if (st.type === 'paragraph' && (s.attr('w:default') === '1' || s.attr('w:default') === 'true')) this.defaultParagraph = id;
    }
  }
  chain(id) {
    const out = [];
    const seen = new Set();
    while (id && this.byId.has(id) && !seen.has(id)) {
      seen.add(id);
      const s = this.byId.get(id);
      out.unshift(s);
      id = s.basedOn;
    }
    return out;
  }
  resolveP(pStyleId) {
    const p = { ...this.defaults.p };
    const r = { ...this.defaults.r };
    let headingLevel;
    let name = '';
    for (const s of this.chain(pStyleId ?? this.defaultParagraph)) {
      Object.assign(p, s.p);
      Object.assign(r, s.r);
      name = s.name;
      const m = s.name.match(HEADING_NAME_RE);
      if (m) headingLevel = parseInt(m[1], 10);
    }
    if (headingLevel === undefined && p.outline !== undefined && p.outline < 9) headingLevel = p.outline + 1;
    return { p, r, headingLevel, name };
  }
  resolveR(rStyleId) {
    const r = {};
    for (const s of this.chain(rStyleId)) Object.assign(r, s.r);
    return r;
  }
}

function rels(xml) {
  const map = new Map();
  if (!xml) return map;
  for (const r of parseXml(xml).findAll('pr:Relationship')) {
    map.set(r.attr('Id'), { type: r.attr('Type'), target: r.attr('Target') });
  }
  return map;
}

function resolvePath(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/** Walk paragraph content and produce runs. */
class RunCollector {
  constructor(styles, paraR, noteMap) {
    this.styles = styles;
    this.paraR = paraR;
    this.noteMap = noteMap;
    this.runs = [];
    this.fieldDepth = []; // stack: 'code' | 'result'
    this.pageBreak = false;
    this.sizes = new Map(); // size -> chars
    this.langs = new Map();
  }
  get inFieldCode() {
    return this.fieldDepth.length > 0 && this.fieldDepth[this.fieldDepth.length - 1] === 'code';
  }
  walk(el) {
    for (const c of el.children) {
      if (typeof c === 'string') continue;
      switch (c.name) {
        case 'w:r': this.run(c); break;
        case 'w:del': case 'w:moveFrom': break; // deleted text
        case 'w:ins': case 'w:moveTo': case 'w:hyperlink': case 'w:smartTag': case 'w:customXml':
        case 'w:fldSimple': case 'w:bdo': case 'w:dir':
          this.walk(c); break;
        case 'w:sdt': { const sc = c.child('w:sdtContent'); if (sc) this.walk(sc); break; }
        case 'mc:AlternateContent': break; // drawings, text boxes
        default: break;
      }
    }
  }
  run(r) {
    const direct = readRPr(r.child('w:rPr'));
    const fromChar = direct.rStyle ? this.styles.resolveR(direct.rStyle) : {};
    const props = { ...this.paraR, ...fromChar, ...direct };
    if (props.vanish) return;
    for (const c of r.children) {
      if (typeof c === 'string') continue;
      switch (c.name) {
        case 'w:fldChar': {
          const t = c.attr('w:fldCharType');
          if (t === 'begin') this.fieldDepth.push('code');
          else if (t === 'separate' && this.fieldDepth.length) this.fieldDepth[this.fieldDepth.length - 1] = 'result';
          else if (t === 'end') this.fieldDepth.pop();
          break;
        }
        case 'w:instrText': break;
        case 'w:t': if (!this.inFieldCode) this.text(c.text, props); break;
        case 'w:tab': case 'w:ptab': if (!this.inFieldCode) this.text(' ', props); break;
        case 'w:noBreakHyphen': this.text('‑', props); break;
        case 'w:softHyphen': break;
        case 'w:sym': {
          const ch = parseInt(c.attr('w:char') ?? '', 16);
          // Symbol-font private-use characters cannot be mapped reliably.
          if (ch && !(ch >= 0xf000 && ch <= 0xf0ff)) this.text(String.fromCodePoint(ch), props);
          break;
        }
        case 'w:br': case 'w:cr': {
          const type = c.attr('w:type');
          if (type === 'page' || type === 'column') this.pageBreak = true;
          else this.runs.push({ br: true });
          break;
        }
        case 'w:footnoteReference': case 'w:endnoteReference': {
          const kind = c.name === 'w:footnoteReference' ? 'f' : 'e';
          const id = `${kind}${c.attr('w:id')}`;
          if (this.noteMap.has(id)) this.runs.push({ note: id });
          break;
        }
        default: break;
      }
    }
  }
  text(t, props) {
    if (!t) return;
    let s = t;
    if (props.caps) s = s.toUpperCase();
    const run = { t: s };
    if (props.i) run.i = true;
    if (props.b) run.b = true;
    if (props.sup) run.sup = true;
    this.runs.push(run);
    const n = s.replace(/\s/g, '').length;
    if (props.sz) this.sizes.set(props.sz, (this.sizes.get(props.sz) ?? 0) + n);
    if (props.lang) this.langs.set(props.lang, (this.langs.get(props.lang) ?? 0) + n);
  }
}

function dominant(map) {
  let best, bestN = -1;
  for (const [k, n] of map) if (n > bestN) { best = k; bestN = n; }
  return best;
}

function readNotes(xml, kind, styles) {
  const map = new Map();
  if (!xml) return map;
  const root = parseXml(xml);
  const tag = kind === 'f' ? 'w:footnote' : 'w:endnote';
  for (const n of root.findAll(tag)) {
    const type = n.attr('w:type');
    if (type && type !== 'normal') continue;
    const runs = [];
    for (const p of n.childrenNamed('w:p')) {
      const pr = readPPr(p.child('w:pPr'));
      const rc = new RunCollector(styles, styles.resolveP(pr.pStyle).r, new Map());
      rc.walk(p);
      if (runs.length && rc.runs.length) runs.push({ t: ' ' });
      runs.push(...rc.runs.filter((r) => !r.sup || r.t?.trim()));
    }
    // strip the leading space that follows the footnoteRef mark
    if (runs[0]?.t) runs[0].t = runs[0].t.replace(/^\s+/, '');
    map.set(`${kind}${n.attr('w:id')}`, runs);
  }
  return map;
}

function plausibleTitle(t) {
  if (!t) return null;
  const s = t.trim();
  if (!s || s.length > 200) return null;
  if (/microsoft word|\.docx?$|^untitled$|^sin t[ií]tulo$|^sense t[ií]tol$|^sans titre$|^documento?\s*\d*$|^document\s*\d*$|^title$|^t[ií]tulo$/i.test(s)) return null;
  return s;
}

/**
 * @param {Uint8Array} bytes the .docx file
 * @returns {{blocks: object[], notes: Map, meta: object, warnings: string[]}}
 */
export function readDocx(bytes) {
  let files;
  try {
    files = unzipSync(bytes, {
      filter: (f) => /^(\[Content_Types\]\.xml|_rels\/\.rels|word\/[^/]+\.xml|word\/_rels\/[^/]+\.rels|docProps\/core\.xml)$/.test(f.name),
    });
  } catch {
    throw new Error('This file is not a valid Word document (.docx). If it is an old .doc file, open it in Word or LibreOffice and save it as .docx.');
  }
  const get = (p) => (files[p] ? strFromU8(files[p]) : null);
  const rootRels = rels(get('_rels/.rels'));
  let mainPath = 'word/document.xml';
  for (const r of rootRels.values()) {
    if (/\/officeDocument$/.test(r.type)) mainPath = resolvePath('', r.target);
  }
  const docXml = get(mainPath);
  if (!docXml) throw new Error('This .docx file has no document body. It may be damaged.');
  const relsPath = mainPath.replace(/([^/]+)$/, '_rels/$1.rels');
  const docRels = rels(get(relsPath));
  const partOf = (suffix) => {
    for (const r of docRels.values()) if (r.type.endsWith(`/${suffix}`)) return get(resolvePath(mainPath, r.target));
    return null;
  };
  const styles = new Styles(partOf('styles'));
  const notes = new Map([...readNotes(partOf('footnotes'), 'f', styles), ...readNotes(partOf('endnotes'), 'e', styles)]);

  const blocks = [];
  const warnings = [];
  const doc = parseXml(docXml);
  const body = doc.child('w:document')?.child('w:body');
  if (!body) throw new Error('This .docx file has no document body. It may be damaged.');
  const langCount = new Map();
  let pendingPageBreak = false;
  let hadTable = false;

  const paragraph = (p) => {
    const ppr = readPPr(p.child('w:pPr'));
    const st = styles.resolveP(ppr.pStyle);
    const pp = { ...st.p, ...ppr };
    const rc = new RunCollector(styles, st.r, notes);
    rc.walk(p);
    const text = rc.runs.map((r) => r.t ?? '').join('');
    for (const [l, n] of rc.langs) langCount.set(l, (langCount.get(l) ?? 0) + n);
    if (!rc.langs.size && st.r.lang) langCount.set(st.r.lang, (langCount.get(st.r.lang) ?? 0) + text.length);
    const block = {
      type: 'p',
      runs: rc.runs,
      align: { center: 'center', both: 'justify', distribute: 'justify', right: 'right', end: 'right' }[pp.jc] ?? 'left',
      size: dominant(rc.sizes) ?? st.r.sz ?? null,
      styleName: st.name,
      pageBreakBefore: !!pp.pageBreakBefore || pendingPageBreak,
    };
    const level = ppr.outline !== undefined && ppr.outline < 9 ? ppr.outline + 1 : st.headingLevel;
    if (level && level <= 3) block.heading = { level, source: 'style' };
    if (/^(title|t[ií]tulo|t[ií]tol|titre)$/i.test(st.name)) block.titleStyle = true;
    if (/^(subtitle|subt[ií]tulo|subt[ií]tol|sous-titre)$/i.test(st.name)) block.subtitleStyle = true;
    pendingPageBreak = rc.pageBreak && text.trim() === '' ? true : false;
    if (rc.pageBreak && text.trim() !== '') pendingPageBreak = true;
    if (!text.trim() && !rc.runs.some((r) => r.note)) {
      blocks.push({ type: 'blank' });
      return;
    }
    blocks.push(block);
  };

  const walkBody = (el) => {
    for (const c of el.children) {
      if (typeof c === 'string') continue;
      if (c.name === 'w:p') paragraph(c);
      else if (c.name === 'w:tbl') {
        hadTable = true;
        for (const tc of c.findAll('w:tc')) walkBody(tc);
      } else if (c.name === 'w:sdt') {
        const sc = c.child('w:sdtContent');
        if (sc) walkBody(sc);
      } else if (c.name === 'w:customXml' || c.name === 'w:ins' || c.name === 'w:moveTo') walkBody(c);
    }
  };
  walkBody(body);
  if (hadTable) warnings.push('The document contains tables; their cells were converted to plain paragraphs.');

  // Body font size (most common by characters) for heading heuristics.
  const sizeChars = new Map();
  for (const b of blocks) {
    if (b.type !== 'p' || !b.size) continue;
    const n = b.runs.reduce((a, r) => a + (r.t?.length ?? 0), 0);
    sizeChars.set(b.size, (sizeChars.get(b.size) ?? 0) + n);
  }
  const bodySize = dominant(sizeChars) ?? 12;
  for (const b of blocks) {
    if (b.type !== 'p') continue;
    b.relSize = b.size ? b.size / bodySize : 1;
    const textRuns = b.runs.filter((r) => r.t && r.t.trim());
    b.allBold = textRuns.length > 0 && textRuns.every((r) => r.b);
    b.allItalic = textRuns.length > 0 && textRuns.every((r) => r.i);
    if (b.heading) continue;
    const text = b.runs.map((r) => r.t ?? '').join('').trim();
    if (text.length > 100 || b.titleStyle) continue;
    // "Fake" heading: big, or bold and centred, without sentence punctuation.
    const noSentence = !/[.!?…]["”»’]?$/.test(text) || /^(cap[ií]tulo|cap[ií]tol|chapter|chapitre)\b/i.test(text);
    if (noSentence && (b.relSize >= 1.25 || (b.allBold && b.align === 'center' && text.length <= 60))) {
      b.heading = { level: b.relSize >= 1.6 ? 1 : 1, source: 'format' };
    }
  }

  // Core properties
  const core = get('docProps/core.xml');
  const meta = {};
  if (core) {
    const c = parseXml(core);
    meta.title = plausibleTitle(c.findAll('dc:title')[0]?.text);
    const author = c.findAll('dc:creator')[0]?.text?.trim();
    if (author && !/^(user|usuario|usuari|utilisateur|admin|owner|author|autor)$/i.test(author)) meta.author = author;
  }
  // Language hint from w:lang (often wrong: Word's UI language) -> weak hint only
  const langHint = dominant(langCount);
  if (langHint) meta.langHint = langHint.slice(0, 2).toLowerCase();

  return { blocks, notes, meta, warnings, source: 'docx' };
}
