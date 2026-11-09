// EPUB 3 writer (with an EPUB 2 NCX for older readers).
// Output passes epubcheck and is accepted by Send to Kindle, Kobo and Apple Books.

import { zipSync, strToU8 } from '../../vendor/fflate/fflate.mjs';
import { dashSegments } from './typography.js';

export const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // characters not allowed in XML 1.0
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');

const LANG_TAGS = { es: 'es', ca: 'ca', en: 'en', fr: 'fr' };

export function uuidv4(random = Math.random) {
  const b = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function runsHtml(runs, chapterFile) {
  let s = '';
  for (const r of runs) {
    if (r.br) { s += '<br/>'; continue; }
    if (r.n !== undefined) {
      s += `<a class="noteref" epub:type="noteref" role="doc-noteref" id="ref${r.n}" href="${chapterFile}#note${r.n}">${r.n}</a>`;
      continue;
    }
    if (r.t === undefined) continue;
    let t = dashSegments(r.t).map(([x, nw]) => (nw ? `<span class="nw">${esc(x)}</span>` : esc(x))).join('');
    if (r.sup) t = `<sup>${t}</sup>`;
    if (r.b) t = `<b>${t}</b>`;
    if (r.i) t = `<i>${t}</i>`;
    s += t;
  }
  return s;
}

const CSS = `@charset "utf-8";
body { margin: 0 3%; }
h1, h2 { font-weight: normal; text-align: center; line-height: 1.3; margin: 3em 0 2em; page-break-after: avoid; break-after: avoid; }
h1 { font-size: 1.5em; }
h2 { font-size: 1.25em; }
p { margin: 0; text-indent: 1.3em; line-height: 1.4; orphans: 2; widows: 2; hyphens: auto; -webkit-hyphens: auto; -epub-hyphens: auto; }
h1 + p, h2 + p, p.first, .scene + p { text-indent: 0; }
p.scene { text-indent: 0; text-align: center; margin: 1em 0; }
.nw { white-space: nowrap; }
a.noteref { font-size: 0.75em; vertical-align: super; line-height: 0; text-decoration: none; }
section.notes { margin-top: 2em; font-size: 0.9em; }
section.notes hr { width: 30%; margin: 0 0 1em 0; }
aside.note p { text-indent: 0; margin-bottom: 0.5em; }
.titlepage { text-align: center; }
.titlepage h1 { margin: 25% 0 0.8em; font-size: 1.8em; }
.titlepage .author { text-indent: 0; text-align: center; font-size: 1.25em; margin: 0 0 3em; }
.titlepage .confidential { text-indent: 0; text-align: center; font-size: 0.85em; font-style: italic; margin-top: 4em; }
nav ol { list-style: none; padding-left: 1em; }
`;

function xhtml({ title, lang, body, bodyClass }) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head>
<meta charset="utf-8"/>
<title>${esc(title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
${body}
</body>
</html>
`;
}

function chapterXhtml(ch, file, bookLang) {
  const lang = LANG_TAGS[ch.lang] ?? bookLang;
  const tag = ch.level === 2 ? 'h2' : 'h1';
  const parts = [`<section epub:type="${ch.level === 1 && ch.isPart ? 'part' : 'chapter'}" role="${ch.isPart ? 'doc-part' : 'doc-chapter'}">`];
  parts.push(`<${tag}>${esc(ch.title)}</${tag}>`);
  for (const b of ch.blocks) {
    if (b.type === 'scene') {
      parts.push('<p class="scene" role="separator">* * *</p>');
    } else {
      const html = runsHtml(b.runs, file);
      const l = b.lang && LANG_TAGS[b.lang] && b.lang !== (ch.lang || bookLang) ? ` xml:lang="${b.lang}" lang="${b.lang}"` : '';
      parts.push(`<p${l}>${html}</p>`);
    }
  }
  if (ch.notes?.length) {
    parts.push('<section class="notes" epub:type="footnotes" role="doc-endnotes">', '<hr/>');
    for (const n of ch.notes) {
      parts.push(`<aside class="note" epub:type="footnote" role="doc-footnote" id="note${n.n}"><p><a href="${file}#ref${n.n}">${n.n}.</a> ${runsHtml(n.runs, file)}</p></aside>`);
    }
    parts.push('</section>');
  }
  parts.push('</section>');
  return xhtml({ title: ch.title, lang, body: parts.join('\n') });
}

/**
 * @param {object} book {meta:{title, author, lang}, chapters:[{title, level, lang?, blocks, notes}]}
 * @param {{confidential?: string, id?: string, modified?: Date, cover?: Uint8Array}} opts
 * @returns {Uint8Array} the .epub file
 */
export function buildEpub(book, opts = {}) {
  const lang = LANG_TAGS[book.meta.lang] ?? 'en';
  const title = book.meta.title || 'Manuscript';
  const author = book.meta.author || '';
  const id = opts.id || `urn:uuid:${uuidv4()}`;
  const modified = (opts.modified || new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const files = {};
  files.mimetype = [strToU8('application/epub+zip'), { level: 0 }];
  files['META-INF/container.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`);
  files['OEBPS/style.css'] = strToU8(CSS);

  const tp = [`<section class="titlepage" epub:type="titlepage">`, `<h1>${esc(title)}</h1>`];
  if (author) tp.push(`<p class="author">${esc(author)}</p>`);
  if (opts.confidential) tp.push(`<p class="confidential">${esc(opts.confidential)}</p>`);
  tp.push('</section>');
  files['OEBPS/titlepage.xhtml'] = strToU8(xhtml({ title, lang, body: tp.join('\n') }));

  const chapters = book.chapters.map((c, i) => ({ ...c, file: `chap${String(i + 1).padStart(3, '0')}.xhtml` }));
  for (const ch of chapters) files[`OEBPS/${ch.file}`] = strToU8(chapterXhtml(ch, ch.file, lang));

  // Navigation: nested two levels (parts > chapters)
  const tree = [];
  for (const ch of chapters) {
    if (ch.level === 2 && tree.length && tree[tree.length - 1].level === 1) tree[tree.length - 1].children.push(ch);
    else tree.push({ ...ch, children: [] });
  }
  const navLi = (n) => `<li><a href="${n.file}">${esc(n.title)}</a>${n.children?.length ? `<ol>${n.children.map(navLi).join('')}</ol>` : ''}</li>`;
  const firstChapter = chapters[0]?.file ?? 'titlepage.xhtml';
  files['OEBPS/nav.xhtml'] = strToU8(xhtml({
    title,
    lang,
    body: `<nav epub:type="toc" id="toc" role="doc-toc"><h1>${esc(title)}</h1><ol>${tree.map(navLi).join('\n')}</ol></nav>
<nav epub:type="landmarks" id="landmarks" hidden="hidden"><ol>
<li><a epub:type="titlepage" href="titlepage.xhtml">${esc(title)}</a></li>
<li><a epub:type="bodymatter" href="${firstChapter}">Start</a></li>
</ol></nav>`,
  }));

  let order = 0;
  const ncxPoint = (n) => {
    order++;
    return `<navPoint id="np${order}" playOrder="${order}"><navLabel><text>${esc(n.title)}</text></navLabel><content src="${n.file}"/>${(n.children || []).map(ncxPoint).join('')}</navPoint>`;
  };
  const ncxPoints = tree.map(ncxPoint).join('\n');
  files['OEBPS/toc.ncx'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${lang}">
<head><meta name="dtb:uid" content="${esc(id)}"/><meta name="dtb:depth" content="${tree.some((t) => t.children.length) ? 2 : 1}"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>
<docTitle><text>${esc(title)}</text></docTitle>
${author ? `<docAuthor><text>${esc(author)}</text></docAuthor>` : ''}
<navMap>
${ncxPoints}
</navMap>
</ncx>
`);

  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    '<item id="titlepage" href="titlepage.xhtml" media-type="application/xhtml+xml"/>',
    ...chapters.map((c, i) => `<item id="c${i + 1}" href="${c.file}" media-type="application/xhtml+xml"/>`),
  ];
  let coverMeta = '';
  if (opts.cover) {
    files['OEBPS/cover.png'] = [opts.cover, { level: 0 }];
    manifest.push('<item id="cover-image" href="cover.png" media-type="image/png" properties="cover-image"/>');
    coverMeta = '\n<meta name="cover" content="cover-image"/>';
  }
  const spine = ['<itemref idref="titlepage"/>', ...chapters.map((c, i) => `<itemref idref="c${i + 1}"/>`)];
  files['OEBPS/content.opf'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${lang}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${esc(id)}</dc:identifier>
<dc:title>${esc(title)}</dc:title>
${author ? `<dc:creator id="author">${esc(author)}</dc:creator>` : ''}
<dc:language>${lang}</dc:language>
<meta property="dcterms:modified">${modified}</meta>${coverMeta}
</metadata>
<manifest>
${manifest.join('\n')}
</manifest>
<spine toc="ncx">
${spine.join('\n')}
</spine>
</package>
`);
  // mimetype first and stored; the rest deflated
  return zipSync(files, { level: 6, mtime: new Date('2000-01-01T00:00:00Z') });
}
