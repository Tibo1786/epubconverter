import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from '../../vendor/fflate/fflate.mjs';
import mammoth from 'mammoth';
import { readDocx } from '../../src/core/docx.js';
import { convertToBook } from '../../src/core/convert.js';
import { runsText } from '../../src/core/typography.js';
import { runsMarkup } from '../lib/quality.js';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
/** Build a minimal .docx from a <w:body> fragment (and optional styles). */
function docx(body, styles = '') {
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/_rels/document.xml.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="s" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    'word/styles.xml': strToU8(`<?xml version="1.0"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>
      <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
      <w:style w:type="paragraph" w:styleId="Ttulo1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:sz w:val="32"/></w:rPr></w:style>
      <w:style w:type="character" w:styleId="nfasis"><w:name w:val="Emphasis"/><w:rPr><w:i/></w:rPr></w:style>
      <w:style w:type="paragraph" w:styleId="Cita"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:rPr><w:i/></w:rPr></w:style>
      ${styles}</w:styles>`),
    'word/document.xml': strToU8(`<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`),
  });
}
const p = (inner, ppr = '') => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${inner}</w:p>`;
const r = (t, rpr = '') => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${t}</w:t></w:r>`;
const texts = (res) => res.blocks.filter((b) => b.type === 'p').map((b) => runsMarkup(b.runs));

test('italics from a character style and from a paragraph style; direct override off', () => {
  const res = readDocx(docx(
    p(r('Una ') + r('palabra', '<w:rStyle w:val="nfasis"/>') + r(' en cursiva.')) +
    p(r('Todo cursiva ') + r('salvo esto', '<w:i w:val="0"/>'), '<w:pStyle w:val="Cita"/>'),
  ));
  assert.deepEqual(texts(res), ['Una *palabra* en cursiva.', '*Todo cursiva *salvo esto']);
});

test('tracked changes: insertions kept, deletions dropped', () => {
  const res = readDocx(docx(p(r('calles ') + `<w:del w:id="1" w:author="x"><w:r><w:delText>muy </w:delText></w:r></w:del>` + `<w:ins w:id="2" w:author="x">${r('estrechas')}</w:ins>` + r(' que subían'))));
  assert.deepEqual(texts(res), ['calles estrechas que subían']);
});

test('fields show their result, not their code; hidden text dropped; soft hyphen dropped', () => {
  const field = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' + r('7') + '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  const res = readDocx(docx(p(r('Página ') + field + r(' oculto', '<w:vanish/>') + '<w:r><w:t>extra</w:t><w:softHyphen/><w:t>ordinario</w:t></w:r>')));
  assert.deepEqual(texts(res), ['Página 7extraordinario']);
});

test('heading by localized style id with English name, and by outline level', () => {
  const res = readDocx(docx(p(r('Capítulo 1'), '<w:pStyle w:val="Ttulo1"/>') + p(r('Texto.')) + p(r('Parte dos'), '<w:outlineLvl w:val="0"/>')));
  const hs = res.blocks.filter((b) => b.heading).map((b) => runsText(b.runs));
  assert.deepEqual(hs, ['Capítulo 1', 'Parte dos']);
});

test('fake heading: bold, centred, larger text in Normal style', () => {
  const body = p(r('CAPÍTULO 2', '<w:b/><w:sz w:val="32"/>'), '<w:jc w:val="center"/>') + p(r('Un párrafo normal de texto que es largo.'));
  const res = readDocx(docx(body));
  assert.equal(res.blocks[0].heading?.source, 'format');
  assert.ok(!res.blocks[1].heading);
});

test('page breaks and line breaks', () => {
  const res = readDocx(docx(p(r('Antes') + '<w:r><w:br w:type="page"/></w:r>') + p(r('Después')) + p(r('verso uno') + '<w:r><w:br/></w:r>' + r('verso dos'))));
  const ps = res.blocks.filter((b) => b.type === 'p');
  assert.equal(ps[1].pageBreakBefore, true);
  assert.ok(ps[2].runs.some((x) => x.br));
});

test('invalid file gives a helpful error', () => {
  assert.throws(() => readDocx(new Uint8Array([1, 2, 3, 4])), /not a valid Word document/);
});

// Independent oracle: every paragraph we produce must exist, word for word,
// in mammoth's extraction of the same file (typography normalised).
for (const name of ['novel-es.docx', 'bilingual-ca-en.docx']) {
  test(`mammoth agrees on the text of ${name}`, async () => {
    const bytes = readFileSync(new URL(`../fixtures/${name}`, import.meta.url));
    const { value } = await mammoth.extractRawText({ buffer: bytes });
    const key = (s) => s.replace(/[“”«»"]/g, '"').replace(/[‘’']/g, "'").replace(/\u00ad/g, '').replace(/[\s\u00a0]+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
    const theirs = new Set(value.split(/\n+/).map(key).filter(Boolean));
    const book = await convertToBook(new Uint8Array(bytes), name);
    const ours = book.chapters.flatMap((c) => c.blocks.filter((b) => b.type === 'p').map((b) => key(runsText(b.runs).replace(/‑/g, '-'))));
    const missing = ours.filter((t) => !theirs.has(t));
    assert.deepEqual(missing, []);
  });
}
