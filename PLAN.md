# Manuscript Reader: plan

A static web app that turns a manuscript (DOCX, PDF with a text layer, or TXT) into a clean, reflowable EPUB 3, entirely in the browser.

## 1. Research summary and choices

| Step | Options looked at | Choice | Why |
|---|---|---|---|
| DOCX | **mammoth.js 1.13** (maps DOCX to HTML through style maps) vs **parsing the DOCX XML ourselves** | **Parse it ourselves** (unzip with fflate plus a small XML reader) | Mammoth throws away exactly what chapter detection needs in manuscripts that don't use Heading styles: font size, centring, `pageBreakBefore`/page breaks, `outlineLvl`, and italics inherited from character or paragraph styles. Authors often type "CAPÍTULO 3" in bold, centred, 14 pt, in the *Normal* style. We also need tracked changes resolved (keep insertions, drop deletions), footnotes and soft hyphens. That's about 500 lines we fully control. Mammoth stays in the test suite as an independent oracle: its plain text must match ours word for word. |
| PDF text and positions | **pdf.js** (`pdfjs-dist` 6.5.x) | pdf.js, vendored, worker build | It's the only serious in-browser option. `getTextContent()` gives each glyph run's position, width, height and font. Bold and italic come from the real font name (`commonObjs`), e.g. `Garamond-Italic`. It runs with `isEvalSupported:false` and no cMap or font fetches, which keeps the CSP strict. |
| PDF reflow | Calibre (line-length histogram, "unwrap factor"), pdftotext (line grouping by baseline, column detection), Marker and Docling (layout ML: too heavy for a phone and not needed for single-column prose) | A **deterministic heuristic pipeline** inspired by Calibre and pdftotext, tuned on statistics from the document itself | Manuscripts are almost always single-column, uniform prose, so statistics beat machine learning here and stay explainable and testable. |
| EPUB packaging | epub-gen / epub-gen-memory (pulls in ejs and an HTTP image fetcher, little control over nav and NCX, unmaintained since 2024), JSZip 3.10 (~100 kB), **fflate 0.8** (~8 kB ES module) | **Our own EPUB writer on fflate** | Full control over the exact markup epubcheck and Send to Kindle want. `mimetype` is written first and STORED. fflate is tiny and works the same in Node and the browser. |

**Stack:** plain HTML, CSS and ES modules, with **no build step**. Libraries are copied from npm into `vendor/` by a small script (`npm run vendor`), pinned in `package.json`, and committed. npm is used only for dev tooling (Playwright, mammoth as the test oracle).

## 2. Architecture

```
  input file ──► reader ──► Document IR ──► cleanup passes ──► structure ──► EPUB writer ──► Blob
            (docx/pdf/txt)   (blocks+runs)   (typography, lang)  (chapters, TOC)   (fflate)
```

All of `src/core/` is pure JS with no DOM, so the **same code runs in Node tests and in the browser**.

- `src/core/ir.js`: the shared model. `{meta:{title,author,lang}, blocks:[{type:'p'|'h'|'break', level?, runs:[{t, i?, b?}], align?, lang?}]}`
- `src/core/docx/`: unzip, a minimal namespace-aware XML reader, style inheritance (docDefaults → paragraph style → character style → direct formatting), runs, breaks, tracked changes, footnotes (rendered as endnotes in the EPUB), `core.xml` for title and author, `w:lang` for language.
- `src/core/pdf/`: pdf.js glyph runs → lines → page statistics → header/footer removal → paragraphs → dehyphenation → headings. Every pass is its own function with unit tests.
- `src/core/txt.js`: blank-line paragraphs, or hard-wrapped text unwrapped with the same line logic as PDF.
- `src/core/structure.js`: chapter detection (shared across inputs), scene breaks, title-page detection, splitting into chapters.
- `src/core/typography.js`: NFC, ligatures (ﬁ→fi), `ŀl`/`l.l`→`l·l`, straight to curly quotes, `--`→—, French and «» narrow no-break spaces, collapsing spaces, keeping ¿ ¡ « » as they are.
- `src/core/lang.js`: a tiny stopword classifier for es/ca/en/fr (no dependency). It picks the document language and tags long paragraphs that are clearly in another language with `xml:lang`, which helps hyphenation and dictionaries on e-readers. The user can override it in the UI.
- `src/core/epub.js`: OPF (EPUB 3 with dcterms:modified and a urn:uuid id), `nav.xhtml`, **plus `toc.ncx`** for older Kobo and Kindle pipelines, a title page, one XHTML file per chapter, and a minimal CSS file with no embedded fonts so the reader's own fonts and settings apply.
- `src/ui/`: file picker and drag-drop, editable title, author, language and the "Confidential submission, received <date>" toggle, a preview of the detected chapters plus warnings ("scanned PDF", "no chapters found"), then **Download** and, on phones, **Share** (the Web Share API with files, which goes straight to the Kindle app's "Send to Kindle" share target).
- PDF parsing runs in a Web Worker so the UI stays responsive on a phone.

### PDF reflow heuristics (the core engineering)

1. **Lines:** group glyph runs by baseline (tolerance 0.3×font size), sort by x, insert spaces from horizontal gaps relative to font size, and use pdf.js `hasEOL` as a hint.
2. **Document statistics:** the most common body font size, line pitch, left margin, right edge (the 90th percentile of line ends), and indent width.
3. **Headers, footers, page numbers:** look at lines in the top and bottom 12% of each page. Normalise digits to `#`, then remove a line if the same text repeats on at least 30% of pages, with odd and even pages compared separately (author name on one side, title on the other). Lone page numbers are also removed in any form (`12`, `- 12 -`, `xii`, `Página 12 de 300`, `12 / 300`).
4. **Paragraph breaks.** A new paragraph starts when any of these holds:
   - the vertical gap is more than 1.5× the line pitch
   - there is a first-line indent
   - the previous line ends well short of the right edge *and* ends with terminal punctuation or a closing quote
   - the font or size changes
   - a Spanish dialogue line starts with a dash `—`

   Paragraphs continue across page breaks unless the next page starts with an indent or a heading.
5. **Dehyphenation:** a line ending in `-`, U+00AD or U+2010 after a letter, with the next line starting in lowercase, gets joined.
   - If the hyphenated form appears elsewhere in the middle of a line (`franco-alemán`, `well-known`), keep the hyphen. Otherwise join.
   - Catalan `col-` + `lecció` becomes `col·lecció` (the l·l split rule).
   - A line ending in an em dash joins with no space.
6. **Headings:** a line is a heading when its size is at least 1.2× body size, *or* it's short, isolated and centred or upper-case, *or* it matches the chapter pattern list in four languages (Capítulo/Capítol/Chapter/Chapitre, Parte/Part/Partie, Prólogo/Pròleg/Prologue, Epílogo/Epíleg/Epilogue, Interludio…, numerals in Arabic, Roman or words). It's helped by sitting at the top of a page. A heading followed by a short subtitle line merges into "Capítulo 1. El regreso".
7. **Scene breaks:** lines made only of `* # ⁂ ~ • —` (any spacing), plus large vertical gaps in the middle of a page with no heading. They are emitted as `<hr class="scene"/>` styled as a centred `* * *`.
8. **Scanned PDF:** fewer than ~20 characters of text per page on average is reported as "This PDF is a scan (images only). Ask the author or agent for the Word file." No OCR in v1.

## 3. Privacy model, enforced

- A CSP `<meta>` on every page:
  - `default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'self'; img-src 'self' data: blob:; manifest-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'`
  - `connect-src 'none'` means page code **cannot make any network request at all**: no fetch, XHR, WebSocket or beacon.
- No analytics, no fonts or scripts from a CDN, and nothing in `localStorage` except UI preferences. The file never leaves memory.
- **A test proves it:** the Playwright suite records every network request during conversion and fails if there is even one.
- The README explains how anyone can check this: view source and the CSP, or use DevTools → Network.
- Limitation: GitHub Pages can't send HTTP headers, so `frame-ancestors` isn't available. That doesn't matter for confidentiality.

## 4. Test corpus (built before the converter)

All prose is original text I write (no copyrighted material). Each fixture has a **ground-truth JSON** (`expected.json`: title, author, language, chapter titles, and every paragraph with its italics markers). Generators live in `test/fixtures/src/`. The generated binaries are committed so CI doesn't depend on LibreOffice.

| Fixture | Produced with | Exercises |
|---|---|---|
| `novel-es.docx` | python-docx | Heading styles *and* "fake" headings (bold, centred, Normal style), italics and bold including style-inherited italics, scene breaks `*`, `***`, `#`, «» ¿ ¡, dialogue dashes, a footnote, a tracked insertion and deletion, soft hyphens |
| `novel-es.pdf` | the same DOCX through LibreOffice (closest to "Export to PDF" from Word) with justified text, automatic hyphenation, running header (author/title), centred page numbers, chapters starting on new pages | headers, footers, hyphenation, paragraph rebuilding, cross-page paragraphs |
| `bilingual-ca-en.docx` / `.pdf` | python-docx + LibreOffice | Catalan (l·l, `col-lecció` hyphenation), English section, per-paragraph language |
| `novel-fr.pdf` | reportlab (a different PDF producer, block paragraphs, no indents, page numbers "– 12 –") | robustness to a different layout |
| `plain-en.txt` | hand-written | hard-wrapped text, `--` dashes, straight quotes |
| `scanned.pdf` | page images rasterised with ImageMagick | the scanned-PDF warning |

**Quality metrics** (`test/quality.test.js`) for every fixture:
- **Paragraph exact-match rate** against the ground truth. Target: 100% for DOCX and TXT, at least 98% for PDF. The test prints diffs of any misses.
- **Chapter list** must equal the expected list exactly.
- **Forbidden strings:** no running header text, no page numbers, no `-` followed by a space and a lowercase letter, no paragraph ending without punctuation followed by one starting in lowercase.
- Italic spans in DOCX must match.

Real manuscripts must **never** be committed. I'll add `npm run try <file>` so you can test on real files locally and see a quality report.

## 5. Tests and CI

- `node --test`: unit tests for each reflow, heading, typography, language and EPUB pass, plus the quality suite over the fixtures (pure Node, pdf.js legacy build).
- Playwright (Chromium): load the built site, upload each fixture, download the EPUB, check its contents, and **assert zero network requests** during conversion. There's also a phone-viewport smoke test and an offline test (service worker, then go offline, then convert).
- **epubcheck 5.4.0** (Java, from Maven Central, cached in CI) on every EPUB the e2e tests produce. Any error or warning fails the build.
- GitHub Actions: `test` job (Node 22, Java 21, Playwright), then a `deploy` job (`actions/deploy-pages`) on push to `main` only.

## 6. PWA

`manifest.webmanifest`, icons, and a service worker that precaches every app file under a versioned cache name, so the app works fully offline after the first visit and can be installed from Safari or Chrome. The service worker only ever serves its own files.

## 7. Repo layout

```
index.html  app.css  sw.js  manifest.webmanifest  icons/
src/core/…  src/ui/…  vendor/{pdfjs,fflate}/
test/unit/  test/quality.test.js  test/e2e/  test/fixtures/{src,*.docx,*.pdf,*.txt,*.expected.json}
scripts/{vendor.mjs,try.mjs,epubcheck.sh}
.github/workflows/ci.yml  README.md  CLAUDE.md  PLAN.md
```

## 8. Known limits for v1

No OCR. No multi-column PDFs (rare for manuscripts; a warning is shown). Images in the DOCX are dropped in v1 (manuscripts rarely have them; easy to add later). Kindle delivery itself can't be tested in CI. That needs a real device, and I'll leave a checklist.

## 9. Phase 2 (README only)

The "reading room", which needs a Supabase EU backend.
