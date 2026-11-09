import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from '../../vendor/fflate/fflate.mjs';
import { buildEpub, esc } from '../../src/core/epub.js';
import { parseXml } from '../../src/core/xml.js';

const book = {
  meta: { title: 'El far & <les> col·leccions', author: 'Jordi Pujol', lang: 'ca' },
  chapters: [
    { title: 'Primera part', level: 1, blocks: [{ type: 'p', runs: [{ t: 'Intro.' }] }], notes: [] },
    { title: 'Capítol 1', level: 2, blocks: [
      { type: 'p', runs: [{ t: 'Text amb ' }, { t: 'cursiva', i: true }, { t: ' i nota' }, { note: 'x', n: 1 }, { t: '.' }] },
      { type: 'scene' },
      { type: 'p', lang: 'en', runs: [{ t: 'An English paragraph.' }] },
    ], notes: [{ n: 1, runs: [{ t: 'La nota.' }] }] },
    { title: 'Letter', level: 2, lang: 'en', blocks: [{ type: 'p', runs: [{ t: 'Dear Michael' }] }], notes: [] },
  ],
};

const files = (bytes) => unzipSync(bytes);

test('zip layout: mimetype first and stored', () => {
  const bytes = buildEpub(book, { id: 'urn:uuid:00000000-0000-4000-8000-000000000000', modified: new Date('2026-11-09T10:00:00Z') });
  // local file header: name starts at offset 30, method at offset 8
  assert.equal(strFromU8(bytes.subarray(30, 38)), 'mimetype');
  assert.equal(bytes[8] | (bytes[9] << 8), 0, 'stored, not deflated');
  assert.equal(strFromU8(bytes.subarray(38, 58)), 'application/epub+zip');
});

test('package metadata: language, title, author, modified', () => {
  const f = files(buildEpub(book, { modified: new Date('2026-11-09T10:00:00.123Z') }));
  const opf = strFromU8(f['OEBPS/content.opf']);
  assert.match(opf, /<dc:language>ca<\/dc:language>/);
  assert.match(opf, /<dc:title>El far &amp; &lt;les&gt; col·leccions<\/dc:title>/);
  assert.match(opf, /<dc:creator id="author">Jordi Pujol<\/dc:creator>/);
  assert.match(opf, /dcterms:modified">2026-11-09T10:00:00Z</);
});

test('every XHTML file is well-formed and carries the right language', () => {
  const f = files(buildEpub(book, { confidential: 'Confidential submission, received 9 November 2026' }));
  for (const [name, data] of Object.entries(f)) {
    if (!name.endsWith('.xhtml')) continue;
    const doc = parseXml(strFromU8(data));
    assert.ok(doc.child('html'), name);
  }
  assert.match(strFromU8(f['OEBPS/chap003.xhtml']), /xml:lang="en"/);
  assert.match(strFromU8(f['OEBPS/chap002.xhtml']), /<p xml:lang="en" lang="en">An English paragraph.<\/p>/);
  assert.match(strFromU8(f['OEBPS/titlepage.xhtml']), /Confidential submission, received 9 November 2026/);
});

test('notes are linked both ways; italics and scene breaks are rendered', () => {
  const f = files(buildEpub(book));
  const ch = strFromU8(f['OEBPS/chap002.xhtml']);
  assert.match(ch, /<i>cursiva<\/i>/);
  assert.match(ch, /epub:type="noteref"[^>]*href="chap002.xhtml#note1"/);
  assert.match(ch, /<aside class="note" epub:type="footnote"[^>]*id="note1"><p><a href="chap002.xhtml#ref1">1.<\/a> La nota.<\/p><\/aside>/);
  assert.match(ch, /class="scene"/);
});

test('navigation is nested (part > chapters) in nav and NCX', () => {
  const f = files(buildEpub(book));
  const nav = strFromU8(f['OEBPS/nav.xhtml']);
  assert.match(nav, /<li><a href="chap001.xhtml">Primera part<\/a><ol><li><a href="chap002.xhtml">Capítol 1<\/a><\/li><li><a href="chap003.xhtml">Letter<\/a><\/li><\/ol><\/li>/);
  const ncx = strFromU8(f['OEBPS/toc.ncx']);
  assert.equal((ncx.match(/<navPoint /g) || []).length, 3);
});

test('escaping drops characters that are illegal in XML', () => {
  assert.equal(esc('a\u0001b<'), 'ab&lt;');
});
