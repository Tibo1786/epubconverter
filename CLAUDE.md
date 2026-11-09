# CLAUDE.md

A static web app (GitHub Pages) that converts manuscripts (DOCX, PDF, TXT) into EPUB 3 **entirely in the browser**. Conversion quality is the core of the project. Confidentiality is a hard requirement.

## Hard rules

- **Nothing may leave the device.** Keep the CSP in `index.html` (`connect-src 'none'`, `default-src 'none'`, `script-src 'self'`). Add no analytics, CDNs, web fonts or runtime fetches. `test/unit/app-files.test.js` and the e2e network assertions enforce this.
- **No build step, no framework.** Plain ES modules. Runtime libraries are pinned in `package.json` and copied to `vendor/` by `npm run vendor`. Never edit `vendor/` by hand; CI diffs it against npm.
- **`src/core/` must stay DOM-free** (no `document`, `window`, `DOMParser`), so it runs in Node tests and the browser alike. pdf.js is injected (`opts.pdfjs`).
- **Never commit real manuscripts.** Test texts are original, synthetic prose in `test/fixtures/src/corpus.py`.
- **When adding a file under `src/`, add it to `ASSETS` in `sw.js`** (a test fails otherwise), and bump `VERSION` when shipping a change.

## Architecture

```
bytes ─► reader ─► raw blocks ─► structure.buildBook ─► book ─► epub.buildEpub ─► .epub
         docx.js      {type:'p', runs, heading?, align, relSize…} | {type:'blank'} | {type:'scene'}
         txt.js
         pdf/reader.js (pdf.js glue) → pdf/reflow.js (pure)
```

- `src/core/convert.js`: entry point. `readManuscript(bytes, name, opts)` does the slow part (unzip / pdf.js) and returns raw blocks (plus the raw PDF pages). `buildFromRaw(raw, {lang, faithful, headingRule})` builds the book and is cheap to call again when options change. `convertToBook` does both.
- `src/core/xml.js`: a tiny namespace-aware XML parser. Element names are canonicalised by namespace URI, so `w:p` is always WordprocessingML.
- `src/core/docx.js`:
  - style inheritance (docDefaults → paragraph style chain → char style → direct)
  - headings by style name or outline level, plus "fake" headings (big, or bold and centred)
  - tracked changes, fields, footnotes and endnotes, hidden text, breaks
- `src/core/pdf/reflow.js`. Each step is exported and unit-tested:
  1. `buildLines`: baseline clustering, space inference from gaps, superscripts
  2. `docStats`: body font size, line pitch, paragraph gap, margins per page, first-line indent
  3. `stripFurniture`: repeated top/bottom lines, page numbers, "Página N de M" and the book's own title or author in the margins; footnote extraction
  (before 1: `dropOverlaps` removes text drawn on top of the same text, and drop caps are glued to the line beside them)
  4. `classify`: heading (size ≥ 1.15× body, or centred and chapter-like), scene, body
  5. `assemble`: paragraph breaks from indent, gap, or a short line ending a sentence; cross-page continuation; dehyphenation
- `src/core/structure.js`, shared by all readers:
  - typography
  - blank-line scene breaks (adaptive)
  - heading kinds via `patterns.js`, merging heading and subtitle, parts versus chapters
  - conservative front-matter removal (title, author, contact lines only)
  - chapter and paragraph languages
  - note numbering
- `src/core/typography.js`: run-level fixes, curly quotes using the whole paragraph as context, French spaces, run merging.
- `src/core/dehyphen.js`: the line-end hyphen decision (soft hyphen, Catalan l·l, document evidence, upper case).
- `src/core/lang.js`: stopword classifier for es/ca/en/fr.
- `src/core/headings.js`: chapter titles by "look". `headingOptions(blocks)` lists the rules a document supports (style, size, bold, caps, number, centre); `matchesRule`; `fallbackRule`, used when automatic detection finds no chapter.
- `src/core/diagnostic.js`: privacy-safe problem report. `anonymizeText` (letters → x/X; kept: punctuation, digits in short lines, function words, chapter words; PDF word fragments are always masked), `anonymizeDocx`, `buildDiagnosticReport(raw, book)` → zip with `report.json` (+ `anonymized.docx`). Replay one with `node scripts/replay-report.mjs report.zip [--faithful] [--rule bold]`.
- `src/core/epub.js`: EPUB 3 plus NCX, one XHTML per chapter, footnotes as `aside epub:type="footnote"`, optional cover. The zip comes from fflate with `mimetype` first and stored.
- `src/ui/reader.js`: the in-browser reader. Pages mode paginates with CSS columns (one or two columns per screen) and turns pages with `scrollLeft`; scroll mode is plain vertical scrolling. One chapter is rendered at a time, with DOM text nodes only (never `innerHTML`). The position (`{c, b}` = chapter and block index) and settings live in `localStorage`, never the text. Words glued to dialogue dashes are wrapped in no-wrap spans (`dashSegments` in typography.js), in the EPUB too.
- `src/ui/app.js`: the UI. It lazy-loads pdf.js, builds the cover on a canvas, and handles download, Web Share and the service worker.

The run model is `{t, i?, b?, sup?}`, `{note: id}` (becoming `{note, n}` after numbering), or `{br: true}`.

## Tests

| Command | What |
|---|---|
| `npm test` | Node test runner: `test/unit/*.test.js` plus `test/quality.test.js` |
| `npm run test:e2e` | Playwright, desktop and Pixel 7. Converts every fixture in Chromium, saves the EPUBs to `out/e2e/`, asserts no network traffic, the CSP, offline mode and the phone layout. `reader.spec.js` covers the reader: paging, contents, notes, back button, resume, settings, no network, no stored text, markup injection, both layouts. Locally with a preinstalled Chromium: `PW_CHROMIUM=/path/to/chrome npm run test:e2e` |
| `npm run epubcheck` / `bash scripts/epubcheck.sh files…` | epubcheck 5.4.0 (downloaded to `.cache/`, SHA-256 pinned), with warnings counted as failures |
| `npm run try -- file…` | Convert local files and print a quality report (`src/core/report.js`) |
| `npm run fixtures` | Regenerate `test/fixtures/` (needs python-docx, reportlab, LibreOffice, poppler) |

**Quality is measured, not eyeballed.** Every fixture has `<name>.expected.json` (ground truth: metadata, chapter titles, every block with `*italic*`/`**bold**` markup, notes, and forbidden strings such as running headers). `test/quality.test.js` requires:
- DOCX and TXT: 100% exact paragraphs, markup included
- PDF: at least 98% exact paragraphs (plain text)
- every fixture: the exact chapter list, metadata, chapter languages and notes, no leftover headers or broken hyphens

When you change a heuristic, run `npm test`. If it regresses a fixture, fix the heuristic, never the expectation (unless the ground truth itself is wrong). When a real-world file fails, reproduce the layout with a new synthetic fixture in `make_fixtures.py` (never the real text) and add it to the suite.

Fixture producers are deliberately varied:
- python-docx for DOCX
- LibreOffice for "exported from Word" PDFs (double-spaced and indented, or block paragraphs with a "Página N de M" header)
- a custom reportlab typesetter (`typeset_pdf`) with real hyphenation including Catalan l·l, word-by-word drawing, and "– N –" page numbers
- `typeset_book`, a trade-book layout: word-by-word justified text, drop caps, duplicated fragments in a diagonal band (transparency flattening), a smaller indented letter, a hanging-indent list, titles partly drawn as images (lost glyphs), and bookmarks
- a rasterised scan

**Real-world failures:** ask for a problem report from the app. Replay it, fix the heuristic, then reproduce the layout as a synthetic fixture in `make_fixtures.py`. Example: `plain-titles-en` (bold, left-aligned, unnumbered titles). Never commit the report itself if the user hasn't agreed.

**Faithful mode** (`faithful: true`) must never change a character the author typed, apart from invisible or glyph-level artefacts (NFC, ligatures, ŀl, soft hyphens, odd spaces). A line-end hyphen is kept unless joining is certain (soft hyphen, Catalan l·l, joined form seen in the document).

## Conventions

- Two-space indentation, single quotes, semicolons, ES2022. Comments explain *why*.
- Heuristics take their thresholds from the document's own statistics (body size, pitch, indent), never absolute points.
- Prefer keeping text over dropping it. Front matter and furniture removal must be conservative.
- User-facing messages are plain English and say what to do next (e.g. "ask for the Word file").

## Deploy

`.github/workflows/ci.yml` runs every test plus epubcheck on each push. On `main` it publishes only the public files (`index.html app.css sw.js manifest.webmanifest icons src vendor`) to GitHub Pages. The repo must be public, with Pages set to *Source: GitHub Actions*.
